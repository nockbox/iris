/// <reference types="chrome" />
/**
 * Service Worker: Wallet controller and message router
 * Handles provider requests from content script and popup UI
 */

import { Vault } from '../shared/vault';
import { isNockAddress } from '../shared/validators';
import {
  PROVIDER_METHODS,
  INTERNAL_METHODS,
  ERROR_CODES,
  ALARM_NAMES,
  AUTOLOCK_MINUTES,
  STORAGE_KEYS,
  USER_ACTIVITY_METHODS,
  UI_CONSTANTS,
  APPROVAL_CONSTANTS,
  RPC_ENDPOINT,
} from '../shared/constants';
import type {
  TransactionRequest,
  SignRequest,
  ConnectRequest,
  SignRawTxRequest,
} from '../shared/types';

const vault = new Vault();
let lastActivity = Date.now();
let autoLockMinutes = AUTOLOCK_MINUTES;
let manuallyLocked = false; // Track if user manually locked (don't auto-unlock)
let approvalWindowId: number | null = null; // Track the approval popup window for reuse
let isCreatingWindow = false; // Prevent race condition when creating window
let currentRequestId: string | null = null; // Currently displayed request
let requestQueue: Array<{
  id: string;
  type: 'connect' | 'transaction' | 'sign-message' | 'sign-raw-tx';
}> = []; // Queued requests

/**
 * In-memory cache of approved origins
 * Loaded from storage on startup, persisted on changes
 */
let approvedOrigins = new Set<string>();

/**
 * Request expiration time (5 minutes)
 * Prevents replay attacks on approval requests
 */
const REQUEST_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * RPC connection status
 * Updated by popup via REPORT_RPC_STATUS when actual gRPC calls succeed/fail
 */
let isRpcConnected = true;

/**
 * Load approved origins from storage
 */
async function loadApprovedOrigins(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.APPROVED_ORIGINS]);
  const origins = stored[STORAGE_KEYS.APPROVED_ORIGINS] || [];
  approvedOrigins = new Set(origins);
}

/**
 * Save approved origins to storage
 */
async function saveApprovedOrigins(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.APPROVED_ORIGINS]: Array.from(approvedOrigins),
  });
}

/**
 * Add an origin to the approved list
 */
async function approveOrigin(origin: string): Promise<void> {
  approvedOrigins.add(origin);
  await saveApprovedOrigins();
}

/**
 * Remove an origin from the approved list
 */
async function revokeOrigin(origin: string): Promise<void> {
  approvedOrigins.delete(origin);
  await saveApprovedOrigins();
}

/**
 * Check if origin is approved for provider method access
 */
function isOriginApproved(origin: string): boolean {
  // Allow file:// protocol for local testing in development only
  if (import.meta.env.DEV && origin.startsWith('file://')) {
    return true;
  }

  // Check if origin is in approved list
  return approvedOrigins.has(origin);
}

function cancelPendingRequest(requestId: string, code?: number, message?: string): void {
  const request = pendingRequests.get(requestId);
  if (!request) {
    return;
  }
  pendingRequests.delete(requestId);
  request.sendResponse({
    error: { code: code || 4001, message: message || 'Request was cancelled' },
  });
  if (currentRequestId == requestId) {
    currentRequestId = null;
  }
}

/**
 * Check if a request timestamp has expired
 * @param timestamp - Request creation timestamp
 * @returns true if expired, false if still valid
 */
function isRequestExpired(timestamp: number): boolean {
  return Date.now() - timestamp > REQUEST_EXPIRATION_MS;
}

/**
 * Pending approval requests
 * Maps request ID to the request data and response callback
 */
interface PendingRequest {
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest;
  sendResponse: (response: any) => void;
  origin: string;
  needsUnlock?: boolean; // Flag indicating request is waiting for wallet unlock
}

const pendingRequests = new Map<string, PendingRequest>();

/**
 * Type guard to check if a request is a ConnectRequest
 */
function isConnectRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is ConnectRequest {
  return 'timestamp' in request && !('message' in request) && !('to' in request);
}

/**
 * Type guard to check if a request is a SignRequest
 */
function isSignRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is SignRequest {
  return 'message' in request;
}

/**
 * Type guard to check if a request is a SignRawTxRequest
 */
function isSignRawTxRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is SignRawTxRequest {
  return 'rawTx' in request && 'notes' in request && 'spendConditions' in request;
}

/**
 * Type guard to check if a request is a TransactionRequest
 */
function isTransactionRequest(
  request: TransactionRequest | SignRequest | ConnectRequest | SignRawTxRequest
): request is TransactionRequest {
  return 'to' in request;
}

/**
 * Create an approval popup window (or reuse existing one)
 * Uses MetaMask pattern: single popup window for all approval requests
 * Queues requests if user is currently viewing another request
 */
async function createApprovalPopup(
  requestId: string,
  type: 'connect' | 'transaction' | 'sign-message' | 'sign-raw-tx'
) {
  // If user is currently viewing a different request, queue this one
  if (currentRequestId !== null && currentRequestId !== requestId) {
    // Check if already in queue to prevent duplicates
    const alreadyQueued = requestQueue.some(r => r.id === requestId);
    if (!alreadyQueued) {
      requestQueue.push({ id: requestId, type });
    }
    return;
  }

  // Mark this request as currently displayed
  currentRequestId = requestId;

  let hashPrefix: string;
  if (type === 'connect') {
    hashPrefix = APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX;
  } else if (type === 'transaction') {
    hashPrefix = APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX;
  } else if (type === 'sign-raw-tx') {
    hashPrefix = APPROVAL_CONSTANTS.SIGN_RAW_TX_HASH_PREFIX;
  } else {
    hashPrefix = APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX;
  }
  const popupUrl = chrome.runtime.getURL(`popup/index.html#${hashPrefix}${requestId}`);

  // Try to reuse existing approval window
  if (approvalWindowId !== null) {
    try {
      const existingWindow = await chrome.windows.get(approvalWindowId);

      // Window still exists - update it with new request
      if (existingWindow.tabs && existingWindow.tabs[0]?.id) {
        await chrome.tabs.update(existingWindow.tabs[0].id, { url: popupUrl });
        await chrome.windows.update(approvalWindowId, { focused: true });
        return; // Done - reused existing window
      } else {
        await chrome.windows.remove(approvalWindowId);
        approvalWindowId = null;
      }
    } catch {
      // Window was closed or doesn't exist, create new one
      approvalWindowId = null;
    }
  }

  // Prevent race condition: if window is being created, wait and retry
  if (isCreatingWindow) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return createApprovalPopup(requestId, type);
  }

  // Create new approval window
  isCreatingWindow = true;
  try {
    const width = UI_CONSTANTS.POPUP_WIDTH;
    const height = UI_CONSTANTS.POPUP_HEIGHT;

    // Calculate position near top-right corner (where extension icon typically is)
    // Get the current window to determine screen bounds
    let left = 100;
    let top = 100;

    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow.left !== undefined && currentWindow.width !== undefined) {
        // Position near top-right of current window
        // Place it slightly inward from the edge for better UX
        const marginFromRight = 20;
        const marginFromTop = 80; // Below browser chrome/toolbar

        left = currentWindow.left + currentWindow.width - width - marginFromRight;
        top = currentWindow.top !== undefined ? currentWindow.top + marginFromTop : 80;

        // Ensure it's not off-screen (minimum 0)
        left = Math.max(0, left);
        top = Math.max(0, top);
      }
    } catch (err) {
      // If we can't get current window, use safe default position
      console.warn('Could not determine window position, using defaults');
    }

    const newWindow = await chrome.windows.create({
      url: popupUrl,
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true,
    });

    approvalWindowId = newWindow.id || null;
  } finally {
    isCreatingWindow = false;
  }
}

/**
 * Process next request in queue after current request is resolved
 * Called when user approves or rejects a request
 */
function processNextRequest() {
  if (currentRequestId !== null) {
    cancelPendingRequest(currentRequestId);
  }

  if (requestQueue.length > 0) {
    while (true) {
      const next = requestQueue.shift()!;
      if (!pendingRequests.has(next.id)) {
        continue;
      }
      createApprovalPopup(next.id, next.type);
      break;
    }
  }
}

/**
 * Emit a wallet event to all tabs
 * This notifies dApps of wallet state changes (account switches, network changes, etc.)
 */
async function emitWalletEvent(eventType: string, data: unknown) {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'WALLET_EVENT',
          eventType,
          data,
        });
      } catch (error) {
        // Tab might not have content script, ignore
      }
    }
  }
}

// Initialize auto-lock setting, load approved origins, vault state, connection monitoring, and schedule alarms
(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.AUTO_LOCK_MINUTES]);
  autoLockMinutes = stored[STORAGE_KEYS.AUTO_LOCK_MINUTES] ?? AUTOLOCK_MINUTES;
  await loadApprovedOrigins();
  await vault.init(); // Load encrypted vault header to detect vault existence
  scheduleAlarm();
})();

// Clean up approval window ID when window is closed
chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === approvalWindowId) {
    approvalWindowId = null;
    // If user closed window, process next request in queue
    processNextRequest();
  }
});

/**
 * Track user activity for auto-lock timer
 * Only counts user-initiated actions, not passive polling
 */
function touchActivity(method?: string) {
  if (method && USER_ACTIVITY_METHODS.has(method as any)) {
    lastActivity = Date.now();
  }
}

/**
 * Check if message is from popup/extension page (not content script)
 * Extension pages have chrome-extension:// URLs; content scripts have web URLs
 */
function isFromPopup(sender: chrome.runtime.MessageSender): boolean {
  // Check if the sender URL is from our extension
  const url = sender.url || '';
  const extensionId = chrome.runtime.id;
  return url.startsWith(`chrome-extension://${extensionId}/`);
}

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const { payload } = msg || {};
    touchActivity(payload?.method);

    // Guard: internal methods (wallet:*) can only be called from popup/extension pages
    if (payload?.method?.startsWith('wallet:') && !isFromPopup(_sender)) {
      sendResponse({ error: ERROR_CODES.UNAUTHORIZED });
      return;
    }

    switch (payload?.method) {
      // Provider methods (called from injected provider via content script)
      case PROVIDER_METHODS.CONNECT:
        const connectOrigin = _sender.url || _sender.origin || '';

        // Check if origin is already approved
        if (!isOriginApproved(connectOrigin) || vault.isLocked()) {
          // Clear any existing pending unlock requests from same origin to prevent duplicates
          for (const [existingId, existingData] of pendingRequests.entries()) {
            if (existingData.origin === connectOrigin) {
              cancelPendingRequest(existingId);
            }
          }

          // Origin not approved - show connection approval popup
          const connectRequestId = crypto.randomUUID();
          const connectRequest: ConnectRequest = {
            id: connectRequestId,
            origin: connectOrigin,
            timestamp: Date.now(),
          };

          // Store pending request with response callback
          pendingRequests.set(connectRequestId, {
            request: connectRequest,
            sendResponse,
            origin: connectRequest.origin,
          });

          // Create approval popup
          await createApprovalPopup(connectRequestId, 'connect');

          // Response will be sent when user approves/rejects
          return;
        }

        // Origin approved - return address
        sendResponse({
          pkh: vault.getAddress(),
          grpcEndpoint: RPC_ENDPOINT,
        });

        // Emit connect event when dApp connects successfully
        await emitWalletEvent('connect', { chainId: 'nockchain-1' });
        return;

      case PROVIDER_METHODS.SIGN_MESSAGE:
        // Validate origin
        const signMessageOrigin = _sender.url || _sender.origin || '';
        if (!isOriginApproved(signMessageOrigin)) {
          sendResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        // Create sign message approval request
        const newSignRequestId = crypto.randomUUID();
        const signRequest: SignRequest = {
          id: newSignRequestId,
          origin: signMessageOrigin,
          message: payload.params?.[0] || '',
          timestamp: Date.now(),
        };

        // Store pending request with response callback
        pendingRequests.set(newSignRequestId, {
          request: signRequest,
          sendResponse,
          origin: signRequest.origin,
        });

        // Create approval popup
        await createApprovalPopup(newSignRequestId, 'sign-message');

        // Response will be sent when user approves/rejects
        return;

      case PROVIDER_METHODS.SIGN_RAW_TX:
        // Validate origin
        const signRawTxOrigin = _sender.url || _sender.origin || '';
        if (!isOriginApproved(signRawTxOrigin)) {
          sendResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const rawTxParams = payload.params?.[0];
        if (
          !rawTxParams ||
          !rawTxParams.rawTx ||
          !rawTxParams.notes ||
          !rawTxParams.spendConditions
        ) {
          sendResponse({ error: { code: -32602, message: 'Invalid params' } });
          return;
        }

        const outputs = await vault.computeOutputs(rawTxParams.rawTx);

        // Create sign raw tx approval request
        const signRawTxId = crypto.randomUUID();
        const signRawTxRequest: SignRawTxRequest = {
          id: signRawTxId,
          origin: signRawTxOrigin,
          rawTx: rawTxParams.rawTx,
          notes: rawTxParams.notes,
          spendConditions: rawTxParams.spendConditions,
          outputs: outputs,
          timestamp: Date.now(),
        };

        // Store pending request with response callback
        pendingRequests.set(signRawTxId, {
          request: signRawTxRequest,
          sendResponse,
          origin: signRawTxRequest.origin,
        });

        // Create approval popup
        await createApprovalPopup(signRawTxId, 'sign-raw-tx');

        // Response will be sent when user approves/rejects
        return;

      case PROVIDER_METHODS.SEND_TRANSACTION:
        // Validate origin
        const sendTxOrigin = _sender.url || _sender.origin || '';
        if (!isOriginApproved(sendTxOrigin)) {
          sendResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        const { to, amount, fee } = payload.params?.[0] ?? {};
        if (!isNockAddress(to)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        // Create transaction approval request
        const txRequestId = crypto.randomUUID();
        const txRequest: TransactionRequest = {
          id: txRequestId,
          origin: sendTxOrigin,
          to,
          amount,
          fee,
          timestamp: Date.now(),
        };

        // Store pending request with response callback
        pendingRequests.set(txRequestId, {
          request: txRequest,
          sendResponse,
          origin: txRequest.origin,
        });

        // Create approval popup
        await createApprovalPopup(txRequestId, 'transaction');

        // Response will be sent when user approves/rejects
        return;

      case PROVIDER_METHODS.GET_WALLET_INFO:
        // Validate origin
        const getInfoOrigin = _sender.url || _sender.origin || '';
        if (!isOriginApproved(getInfoOrigin)) {
          sendResponse({ error: { code: 4100, message: 'Unauthorized origin' } });
          return;
        }

        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        sendResponse({
          pkh: vault.getAddress(),
          grpcEndpoint: RPC_ENDPOINT,
        });
        return;

      // Internal methods (called from popup)
      case INTERNAL_METHODS.SET_AUTO_LOCK:
        autoLockMinutes = payload.params?.[0] ?? 15;
        await chrome.storage.local.set({
          [STORAGE_KEYS.AUTO_LOCK_MINUTES]: autoLockMinutes,
        });
        scheduleAlarm();
        sendResponse({ ok: true });
        return;

      case INTERNAL_METHODS.UNLOCK:
        const unlockResult = await vault.unlock(payload.params?.[0]); // password
        sendResponse(unlockResult);

        // Emit connect event when unlock succeeds
        if ('ok' in unlockResult && unlockResult.ok) {
          // Clear manual lock flag when successfully unlocked
          manuallyLocked = false;
          await emitWalletEvent('connect', { chainId: 'nockchain-1' });
        }
        return;

      case INTERNAL_METHODS.LOCK:
        // Set manual lock flag - user explicitly locked, don't auto-unlock
        manuallyLocked = true;
        await vault.lock();
        sendResponse({ ok: true });

        // Emit disconnect event when wallet locks
        await emitWalletEvent('disconnect', { code: 1013, message: 'Wallet locked' });
        return;

      case INTERNAL_METHODS.RESET_WALLET:
        // Reset the wallet completely - clears all data
        await vault.reset();
        manuallyLocked = false;
        sendResponse({ ok: true });

        // Emit disconnect event
        await emitWalletEvent('disconnect', { code: 1013, message: 'Wallet reset' });
        return;

      case INTERNAL_METHODS.SETUP:
        // params: password, mnemonic (optional). If no mnemonic, generates one automatically.
        sendResponse(await vault.setup(payload.params?.[0], payload.params?.[1]));
        return;

      case INTERNAL_METHODS.GET_STATE:
        // Initialize vault state from storage before checking status
        // This ensures hasVault is accurate even after service worker restart
        await vault.init();

        const uiStatus = vault.getUiStatus();
        sendResponse({
          locked: uiStatus.locked,
          hasVault: uiStatus.hasVault,
          address: await vault.getAddressSafe(),
          accounts: vault.getAccounts(),
          currentAccount: vault.getCurrentAccount(),
        });
        return;

      case INTERNAL_METHODS.GET_ACCOUNTS:
        sendResponse({
          accounts: vault.getAccounts(),
          currentAccount: vault.getCurrentAccount(),
        });
        return;

      case INTERNAL_METHODS.SWITCH_ACCOUNT:
        const switchResult = await vault.switchAccount(payload.params?.[0]);
        sendResponse(switchResult);

        // Emit accountsChanged event to all tabs if successful
        if ('ok' in switchResult && switchResult.ok) {
          await emitWalletEvent('accountsChanged', [switchResult.account.address]);
        }
        return;

      case INTERNAL_METHODS.RENAME_ACCOUNT:
        sendResponse(await vault.renameAccount(payload.params?.[0], payload.params?.[1]));
        return;

      case INTERNAL_METHODS.UPDATE_ACCOUNT_STYLING:
        sendResponse(
          await vault.updateAccountStyling(
            payload.params?.[0],
            payload.params?.[1],
            payload.params?.[2]
          )
        );
        return;

      case INTERNAL_METHODS.HIDE_ACCOUNT:
        // params: [accountIndex]
        const hideResult = await vault.hideAccount(payload.params?.[0]);
        sendResponse(hideResult);

        // Emit accountsChanged event to all tabs if successful
        if ('ok' in hideResult && hideResult.ok) {
          const currentAccount = vault.getCurrentAccount();
          if (currentAccount) {
            await emitWalletEvent('accountsChanged', [currentAccount.address]);
          }
        }
        return;

      case INTERNAL_METHODS.CREATE_ACCOUNT:
        // params: name (optional)
        const createResult = await vault.createAccount(payload.params?.[0]);
        sendResponse(createResult);

        // Emit accountsChanged event to all tabs if successful
        // New account is automatically set as current
        if ('ok' in createResult && createResult.ok) {
          await emitWalletEvent('accountsChanged', [createResult.account.address]);
        }
        return;

      case INTERNAL_METHODS.GET_MNEMONIC:
        // params: password (required for verification)
        sendResponse(await vault.getMnemonic(payload.params?.[0]));
        return;

      case INTERNAL_METHODS.GET_AUTO_LOCK:
        sendResponse({ minutes: autoLockMinutes });
        return;

      case INTERNAL_METHODS.GET_BALANCE:
        const balanceResult = await vault.getBalance();
        if ('error' in balanceResult) {
          sendResponse({ error: balanceResult.error });
        } else {
          sendResponse({
            totalNock: balanceResult.totalNock,
            totalNicks: balanceResult.totalNicks.toString(), // Convert bigint to string for JSON
            utxoCount: balanceResult.utxoCount,
          });
        }
        return;

      case INTERNAL_METHODS.GET_BALANCE_FROM_STORE:
        // Get balance from UTXO store - excludes in-flight notes
        // Optional param: account address. If not provided, uses current account.
        const balanceAccountAddress = payload.params?.[0] || vault.getCurrentAccount()?.address;
        if (!balanceAccountAddress) {
          sendResponse({ error: 'No account selected' });
          return;
        }
        try {
          const storeBalance = await vault.getBalanceFromStore(balanceAccountAddress);
          sendResponse(storeBalance);
        } catch (err) {
          console.error('[Background] Error getting balance from store:', err);
          sendResponse({ error: 'Failed to get balance from store' });
        }
        return;

      case INTERNAL_METHODS.GET_CONNECTION_STATUS:
        sendResponse({ connected: isRpcConnected });
        return;

      case INTERNAL_METHODS.REPORT_RPC_STATUS:
        // Popup reports actual gRPC call success/failure
        const rpcHealthy = payload.params?.[0] as boolean;
        if (typeof rpcHealthy === 'boolean' && rpcHealthy !== isRpcConnected) {
          isRpcConnected = rpcHealthy;
        }
        sendResponse({ ok: true });
        return;

      // Note: GET_WALLET_TRANSACTIONS is called directly from popup context
      // to avoid service worker limitations with dynamic imports

      // Approval request handlers
      case INTERNAL_METHODS.GET_PENDING_TRANSACTION:
        const getPendingTxId = payload.params?.[0];
        const txPending = pendingRequests.get(getPendingTxId);
        if (txPending && isTransactionRequest(txPending.request)) {
          sendResponse(txPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_SIGN_REQUEST:
        const getPendingSignId = payload.params?.[0];
        const signPending = pendingRequests.get(getPendingSignId);
        if (signPending && isSignRequest(signPending.request)) {
          sendResponse(signPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_SIGN_RAW_TX_REQUEST:
        const getPendingSignRawTxId = payload.params?.[0];
        const signRawTxPending = pendingRequests.get(getPendingSignRawTxId);
        if (signRawTxPending && isSignRawTxRequest(signRawTxPending.request)) {
          sendResponse(signRawTxPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_TRANSACTION:
        const approveTxId = payload.params?.[0];
        const approveTxPending = pendingRequests.get(approveTxId);
        if (approveTxPending && isTransactionRequest(approveTxPending.request)) {
          const txRequest = approveTxPending.request;

          // Check if request has expired (replay prevention)
          if (isRequestExpired(txRequest.timestamp)) {
            cancelPendingRequest(approveTxId, 4003, 'Request expired');
            sendResponse({ error: 'Request expired' });
            return;
          }

          try {
            // Sign the transaction using the vault
            const txIdHex = await vault.signTransaction(
              txRequest.to,
              txRequest.amount,
              txRequest.fee
            );

            approveTxPending.sendResponse({
              txid: txIdHex,
              amount: txRequest.amount,
              fee: txRequest.fee,
            });
            cancelPendingRequest(approveTxId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (error) {
            console.error('Transaction signing failed:', error);
            approveTxPending.sendResponse({
              error: {
                code: 4900,
                message: error instanceof Error ? error.message : 'Transaction signing failed',
              },
            });
            cancelPendingRequest(approveTxId);
            processNextRequest();
            sendResponse({
              error: error instanceof Error ? error.message : 'Transaction signing failed',
            });
          }
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_TRANSACTION:
        const rejectTxId = payload.params?.[0];
        const rejectTxPending = pendingRequests.get(rejectTxId);
        if (rejectTxPending) {
          cancelPendingRequest(rejectTxId, 4001, 'User rejected the transaction');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_SIGN_MESSAGE:
        const approveSignId = payload.params?.[0];
        const approveSignPending = pendingRequests.get(approveSignId);
        if (approveSignPending && isSignRequest(approveSignPending.request)) {
          const signRequest = approveSignPending.request;

          // Check if request has expired (replay prevention)
          if (isRequestExpired(signRequest.timestamp)) {
            cancelPendingRequest(approveSignId, 4003, 'Request expired');
            sendResponse({ error: 'Request expired' });
            return;
          }

          try {
            const signature = await vault.signMessage([signRequest.message]);
            approveSignPending.sendResponse({ signature });
            cancelPendingRequest(approveSignId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to sign message';
            cancelPendingRequest(approveSignId, 4001, errorMessage);
            processNextRequest();
            sendResponse({ error: errorMessage });
          }
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_SIGN_MESSAGE:
        const rejectSignId = payload.params?.[0];
        const rejectSignPending = pendingRequests.get(rejectSignId);
        if (rejectSignPending) {
          cancelPendingRequest(rejectSignId, 4001, 'User rejected the signature request');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_SIGN_RAW_TX:
        const approveSignRawTxId = payload.params?.[0];
        const approveSignRawTxPending = pendingRequests.get(approveSignRawTxId);

        if (approveSignRawTxPending && isSignRawTxRequest(approveSignRawTxPending.request)) {
          const signRawTxRequest = approveSignRawTxPending.request;

          // Check if request has expired (replay prevention)
          if (isRequestExpired(signRawTxRequest.timestamp)) {
            cancelPendingRequest(approveSignRawTxId, 4003, 'Request expired');
            sendResponse({ error: 'Request expired' });
            return;
          }

          try {
            const signature = await vault.signRawTx({
              rawTx: signRawTxRequest.rawTx,
              notes: signRawTxRequest.notes,
              spendConditions: signRawTxRequest.spendConditions,
            });
            approveSignRawTxPending.sendResponse(signature);
            cancelPendingRequest(approveSignRawTxId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (err) {
            console.error('Failed to sign raw transaction:', err);
            const errorMessage =
              err instanceof Error ? err.message : 'Failed to sign raw transaction';
            cancelPendingRequest(approveSignRawTxId, 4001, errorMessage);
            processNextRequest();
            sendResponse({ error: errorMessage });
          }
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_SIGN_RAW_TX:
        const rejectSignRawTxId = payload.params?.[0];
        const rejectSignRawTxPending = pendingRequests.get(rejectSignRawTxId);
        if (rejectSignRawTxPending) {
          cancelPendingRequest(rejectSignRawTxId, 4001, 'User rejected the signature request');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_CONNECTION:
        const getPendingConnectId = payload.params?.[0];
        const connectPending = pendingRequests.get(getPendingConnectId);
        if (connectPending && isConnectRequest(connectPending.request)) {
          sendResponse(connectPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_CONNECTION:
        const approveConnectId = payload.params?.[0];
        const approveConnectPending = pendingRequests.get(approveConnectId);
        if (approveConnectPending && isConnectRequest(approveConnectPending.request)) {
          const connectRequest = approveConnectPending.request;

          // Check if request has expired (replay prevention)
          if (isRequestExpired(connectRequest.timestamp)) {
            cancelPendingRequest(approveConnectId, 4003, 'Request expired');
            sendResponse({ error: 'Request expired' });
            return;
          }

          // Add origin to approved list
          await approveOrigin(connectRequest.origin);

          // Return wallet info
          approveConnectPending.sendResponse({
            pkh: vault.getAddress(),
            grpcEndpoint: RPC_ENDPOINT,
          });
          cancelPendingRequest(approveConnectId);
          processNextRequest();
          sendResponse({ success: true });

          // Emit connect event
          await emitWalletEvent('connect', { chainId: 'nockchain-1' });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REJECT_CONNECTION:
        const rejectConnectId = payload.params?.[0];
        const rejectConnectPending = pendingRequests.get(rejectConnectId);
        if (rejectConnectPending) {
          cancelPendingRequest(rejectConnectId, 4001, 'User rejected the connection');
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_RAW_TX_REQUEST:
        const getPendingRawTxId = payload.params?.[0];
        const rawTxPending = pendingRequests.get(getPendingRawTxId);

        if (rawTxPending && isSignRawTxRequest(rawTxPending.request)) {
          sendResponse(rawTxPending.request);
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REVOKE_ORIGIN:
        const revokeOriginParam = payload.params?.[0];
        if (
          revokeOriginParam &&
          typeof revokeOriginParam === 'object' &&
          'origin' in revokeOriginParam
        ) {
          await revokeOrigin(revokeOriginParam.origin as string);
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.INVALID_PARAMS });
        }
        return;

      case INTERNAL_METHODS.SIGN_TRANSACTION:
        // params: [to, amount, fee]
        // Called from popup Send screen (not dApp transactions)
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [signTo, signAmount, signFee] = payload.params || [];
        if (!isNockAddress(signTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        try {
          const txid = await vault.signTransaction(signTo, signAmount, signFee);
          sendResponse({ txid });
        } catch (error) {
          console.error('[Background] Transaction signing failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Transaction signing failed',
          });
        }
        return;

      case INTERNAL_METHODS.ESTIMATE_TRANSACTION_FEE:
        // params: [to, amount] - amount in nicks
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [estimateTo, estimateAmount] = payload.params || [];
        if (!isNockAddress(estimateTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        if (typeof estimateAmount !== 'number' || estimateAmount <= 0) {
          sendResponse({ error: 'Invalid amount' });
          return;
        }

        try {
          const result = await vault.estimateTransactionFee(estimateTo, estimateAmount);

          if ('error' in result) {
            sendResponse({ error: result.error });
          } else {
            sendResponse({ fee: result.fee });
          }
        } catch (error) {
          console.error('[Background] Fee estimation error:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Fee estimation failed',
          });
        }
        return;

      case INTERNAL_METHODS.ESTIMATE_MAX_SEND:
        // params: [to] - estimates max sendable amount for "send max" feature
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [maxSendTo] = payload.params || [];
        if (!isNockAddress(maxSendTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        try {
          const maxResult = await vault.estimateMaxSendAmount(maxSendTo);

          if ('error' in maxResult) {
            sendResponse({ error: maxResult.error });
          } else {
            sendResponse({
              maxAmount: maxResult.maxAmount,
              fee: maxResult.fee,
              totalAvailable: maxResult.totalAvailable,
              utxoCount: maxResult.utxoCount,
            });
          }
        } catch (error) {
          console.error('[Background] Max send estimation error:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Max send estimation failed',
          });
        }
        return;

      case INTERNAL_METHODS.SEND_TRANSACTION_V2:
        // params: [to, amount, fee?, sendMax?] - amount and fee in nicks
        // Uses UTXO store for proper note locking and successive transaction support
        // sendMax: if true, uses all available UTXOs and sets refundPKH = recipient for sweep
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [sendToV2, sendAmountV2, sendFeeV2, sendMaxV2] = payload.params || [];
        if (!isNockAddress(sendToV2)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        if (typeof sendAmountV2 !== 'number' || sendAmountV2 <= 0) {
          sendResponse({ error: 'Invalid amount' });
          return;
        }

        try {
          const v2Result = await vault.sendTransactionV2(
            sendToV2,
            sendAmountV2,
            sendFeeV2, // optional, can be undefined
            sendMaxV2 // optional, sweep all UTXOs to recipient
          );

          if ('error' in v2Result) {
            sendResponse({ error: v2Result.error });
            return;
          }

          sendResponse({
            txid: v2Result.txId,
            broadcasted: v2Result.broadcasted,
            walletTx: v2Result.walletTx,
          });
        } catch (error) {
          console.error('[Background] SendTransactionV2 failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Transaction failed',
          });
        }
        return;

      case INTERNAL_METHODS.SEND_TRANSACTION:
        // params: [to, amount, fee] - amount and fee in nicks
        // Called from popup Send screen - builds, signs, and broadcasts transaction
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [sendTo, sendAmount, sendFee] = payload.params || [];
        if (!isNockAddress(sendTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        if (typeof sendAmount !== 'number' || sendAmount <= 0) {
          sendResponse({ error: 'Invalid amount' });
          return;
        }

        if (typeof sendFee !== 'number' || sendFee < 0) {
          sendResponse({ error: 'Invalid fee' });
          return;
        }

        try {
          const result = await vault.sendTransaction(sendTo, sendAmount, sendFee);

          if ('error' in result) {
            sendResponse({ error: result.error });
            return;
          }

          sendResponse({
            txid: result.txId,
            broadcasted: result.broadcasted,
            protobufTx: result.protobufTx, // For dev/debugging - export to file
          });
        } catch (error) {
          console.error('[Background] Transaction sending failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Transaction sending failed',
          });
        }
        return;

      default:
        sendResponse({ error: ERROR_CODES.METHOD_NOT_SUPPORTED });
        return;
    }
  })();
  // Required: tells Chrome we'll call sendResponse asynchronously from the IIFE
  return true;
});

/**
 * Handle auto-lock alarm
 */
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAMES.AUTO_LOCK) return;

  // Don't auto-lock if user manually locked - respect their choice
  if (manuallyLocked) {
    scheduleAlarm();
    return;
  }

  // Don't auto-lock if set to "never" (0 minutes)
  if (autoLockMinutes === 0) {
    scheduleAlarm();
    return;
  }

  const idleMs = Date.now() - lastActivity;
  if (idleMs >= autoLockMinutes * 60_000) {
    await vault.lock();
  }

  scheduleAlarm();
});

/**
 * Schedule the auto-lock alarm (runs every minute)
 */
function scheduleAlarm() {
  chrome.alarms.create(ALARM_NAMES.AUTO_LOCK, {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
}
