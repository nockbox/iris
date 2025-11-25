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
let requestQueue: Array<{ id: string; type: 'connect' | 'transaction' | 'sign-message' | 'sign-raw-tx' }> = []; // Queued requests

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
 */
let isRpcConnected = true;

/**
 * Check RPC connection health
 * Uses a simple fetch to avoid document/DOM dependencies in service worker
 */
async function checkRpcConnection() {
  try {
    // Simple connectivity check with timeout - ping the RPC endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    await fetch(RPC_ENDPOINT, {
      method: 'HEAD',
      mode: 'no-cors', // Avoid CORS issues for health check
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // If we get here without throwing, connection is OK
    if (!isRpcConnected) {
      isRpcConnected = true;
      console.log('[Background] RPC connection restored');
    }
  } catch (error) {
    // Connection failed (timeout, network error, etc.)
    if (isRpcConnected) {
      isRpcConnected = false;
      console.warn('[Background] RPC connection lost:', error);
    }
  }
}

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
  request: TransactionRequest | SignRequest | ConnectRequest;
  sendResponse: (response: any) => void;
  origin: string;
  needsUnlock?: boolean; // Flag indicating request is waiting for wallet unlock
}

const pendingRequests = new Map<string, PendingRequest>();

/**
 * Type guard to check if a request is a ConnectRequest
 */
function isConnectRequest(
  request: TransactionRequest | SignRequest | ConnectRequest
): request is ConnectRequest {
  return 'timestamp' in request && !('message' in request) && !('to' in request);
}

/**
 * Type guard to check if a request is a SignRequest
 */
function isSignRequest(
  request: TransactionRequest | SignRequest | ConnectRequest
): request is SignRequest {
  return 'message' in request;
}

/**
 * Type guard to check if a request is a TransactionRequest
 */
function isTransactionRequest(
  request: TransactionRequest | SignRequest | ConnectRequest
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
      console.log(`[Queue] Request ${requestId} queued. Queue length: ${requestQueue.length}`);
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
      }
    } catch (error) {
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

    // Let Chrome position the popup automatically to avoid bounds errors
    // Chrome will position it in a visible location
    const newWindow = await chrome.windows.create({
      url: popupUrl,
      type: 'popup',
      width,
      height,
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
  currentRequestId = null;

  if (requestQueue.length > 0) {
    const next = requestQueue.shift()!;
    console.log(`[Queue] Processing next request ${next.id}. Remaining: ${requestQueue.length}`);
    createApprovalPopup(next.id, next.type);
  } else {
    console.log('[Queue] No more requests in queue');
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

// Initialize auto-lock setting, load approved origins, vault state, connection monitoring, and schedule alarm
(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.AUTO_LOCK_MINUTES]);
  autoLockMinutes = stored[STORAGE_KEYS.AUTO_LOCK_MINUTES] ?? AUTOLOCK_MINUTES;
  await loadApprovedOrigins();
  await vault.init(); // Load encrypted vault header to detect vault existence
  scheduleAlarm();

  // Initialize RPC connection monitoring
  checkRpcConnection(); // Initial check
  setInterval(checkRpcConnection, 10000); // Check every 10 seconds
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
      case PROVIDER_METHODS.REQUEST_ACCOUNTS:
        const requestAccountsOrigin = _sender.url || _sender.origin || '';

        // If wallet is locked, open popup to unlock (like MetaMask does)
        if (vault.isLocked()) {
          // Clear any existing pending unlock requests from same origin to prevent duplicates
          for (const [existingId, existingData] of pendingRequests.entries()) {
            if (existingData.needsUnlock && existingData.origin === requestAccountsOrigin) {
              // Reject the old request with user rejection error
              existingData.sendResponse({
                error: { code: 4001, message: 'User rejected the request' },
              });
              pendingRequests.delete(existingId);
            }
          }

          // Create a pending request that will continue after unlock
          const unlockRequestId = crypto.randomUUID();
          const unlockRequest: ConnectRequest = {
            id: unlockRequestId,
            origin: requestAccountsOrigin,
            timestamp: Date.now(),
          };

          // Store pending request with response callback
          // Mark it as 'needsUnlock' so we know to process it after unlock
          pendingRequests.set(unlockRequestId, {
            request: unlockRequest,
            sendResponse,
            origin: unlockRequest.origin,
            needsUnlock: true, // Flag to indicate this is waiting for unlock
          });

          // Open popup to unlock (shows home screen with unlock prompt)
          // Use createApprovalPopup to properly track the window
          // Pass a temporary "unlock" request that will be replaced with connect request after unlock
          await createApprovalPopup(unlockRequestId, 'connect');

          // Response will be sent after user unlocks and approves
          return;
        }

        // Check if origin is already approved
        if (!isOriginApproved(requestAccountsOrigin)) {
          // Origin not approved - show connection approval popup
          const connectRequestId = crypto.randomUUID();
          const connectRequest: ConnectRequest = {
            id: connectRequestId,
            origin: requestAccountsOrigin,
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
        const address = vault.getAddress();
        sendResponse([address]);

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
        if (!rawTxParams || !rawTxParams.rawTx || !rawTxParams.notes || !rawTxParams.spendConditions) {
          sendResponse({ error: { code: -32602, message: 'Invalid params' } });
          return;
        }

        // Create sign raw tx approval request
        const signRawTxId = crypto.randomUUID();
        const signRawTxRequest: SignRawTxRequest = {
          id: signRawTxId,
          origin: signRawTxOrigin,
          rawTx: rawTxParams.rawTx,
          notes: rawTxParams.notes,
          spendConditions: rawTxParams.spendConditions,
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

          // Process ONLY THE FIRST pending connect request that was waiting for unlock
          // This prevents multiple popups from opening
          for (const [requestId, pendingData] of pendingRequests.entries()) {
            if (pendingData.needsUnlock && pendingData.request && 'origin' in pendingData.request) {
              const connectRequest = pendingData.request as ConnectRequest;

              // Check if origin needs approval
              if (!isOriginApproved(connectRequest.origin)) {
                // Window is already open from unlock flow - clear currentRequestId so it can update
                currentRequestId = null;
                // Remove the needsUnlock flag - it's now in the approval flow
                delete pendingData.needsUnlock;
                // Update the existing window to show the connect approval screen
                createApprovalPopup(requestId, 'connect'); // Will reuse existing window
              } else {
                // Origin already approved - send address immediately and close window
                const addr = vault.getAddress();
                pendingData.sendResponse([addr]);
                pendingRequests.delete(requestId);
                processNextRequest(); // Process next request or close window
              }

              // Only process the first one, then break
              break;
            }
          }
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

      case INTERNAL_METHODS.GET_CONNECTION_STATUS:
        sendResponse({ connected: isRpcConnected });
        return;

      // Transaction cache handlers
      case INTERNAL_METHODS.ADD_TRANSACTION_TO_CACHE:
        // params: [accountAddress, transaction]
        await vault.addTransactionToCache(payload.params?.[0], payload.params?.[1]);
        sendResponse({ ok: true });
        return;

      case INTERNAL_METHODS.GET_CACHED_TRANSACTIONS:
        // params: [accountAddress]
        const cachedTxs = await vault.getCachedTransactions(payload.params?.[0]);
        sendResponse({ transactions: cachedTxs });
        return;

      case INTERNAL_METHODS.UPDATE_TRANSACTION_STATUS:
        // params: [accountAddress, txid, status]
        await vault.updateTransactionStatus(
          payload.params?.[0],
          payload.params?.[1],
          payload.params?.[2]
        );
        sendResponse({ ok: true });
        return;

      case INTERNAL_METHODS.SHOULD_REFRESH_CACHE:
        // params: [accountAddress]
        const shouldRefresh = await vault.shouldRefreshCache(payload.params?.[0]);
        sendResponse({ shouldRefresh });
        return;

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

      case INTERNAL_METHODS.APPROVE_TRANSACTION:
        const approveTxId = payload.params?.[0];
        const approveTxPending = pendingRequests.get(approveTxId);
        if (approveTxPending && isTransactionRequest(approveTxPending.request)) {
          const txRequest = approveTxPending.request;

          // Check if request has expired (replay prevention)
          if (isRequestExpired(txRequest.timestamp)) {
            approveTxPending.sendResponse({
              error: { code: 4003, message: 'Request expired' },
            });
            pendingRequests.delete(approveTxId);
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
            pendingRequests.delete(approveTxId);
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
            pendingRequests.delete(approveTxId);
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
          rejectTxPending.sendResponse({
            error: { code: 4001, message: 'User rejected the transaction' },
          });
          pendingRequests.delete(rejectTxId);
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
            approveSignPending.sendResponse({
              error: { code: 4003, message: 'Request expired' },
            });
            pendingRequests.delete(approveSignId);
            sendResponse({ error: 'Request expired' });
            return;
          }

          try {
            const signature = await vault.signMessage([signRequest.message]);
            approveSignPending.sendResponse({ signature });
            pendingRequests.delete(approveSignId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to sign message';
            approveSignPending.sendResponse({
              error: { code: 4001, message: errorMessage },
            });
            pendingRequests.delete(approveSignId);
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
          rejectSignPending.sendResponse({
            error: { code: 4001, message: 'User rejected the signature request' },
          });
          pendingRequests.delete(rejectSignId);
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.APPROVE_SIGN_RAW_TX:
        const approveSignRawTxId = payload.params?.[0];
        const approveSignRawTxPending = pendingRequests.get(approveSignRawTxId);

        // Helper to check if request is SignRawTxRequest
        const isSignRawTxRequest = (req: any): req is SignRawTxRequest => {
          return 'rawTx' in req && 'notes' in req && 'spendConditions' in req;
        };

        if (approveSignRawTxPending && isSignRawTxRequest(approveSignRawTxPending.request)) {
          const signRawTxRequest = approveSignRawTxPending.request;

          // Check if request has expired (replay prevention)
          if (isRequestExpired(signRawTxRequest.timestamp)) {
            approveSignRawTxPending.sendResponse({
              error: { code: 4003, message: 'Request expired' },
            });
            pendingRequests.delete(approveSignRawTxId);
            sendResponse({ error: 'Request expired' });
            return;
          }

          try {
            const signature = await vault.signRawTx({
              rawTx: signRawTxRequest.rawTx,
              notes: signRawTxRequest.notes,
              spendConditions: signRawTxRequest.spendConditions
            });
            approveSignRawTxPending.sendResponse(signature);
            pendingRequests.delete(approveSignRawTxId);
            processNextRequest();
            sendResponse({ success: true });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to sign raw transaction';
            approveSignRawTxPending.sendResponse({
              error: { code: 4001, message: errorMessage },
            });
            pendingRequests.delete(approveSignRawTxId);
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
          rejectSignRawTxPending.sendResponse({
            error: { code: 4001, message: 'User rejected the signature request' },
          });
          pendingRequests.delete(rejectSignRawTxId);
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
            approveConnectPending.sendResponse({
              error: { code: 4003, message: 'Request expired' },
            });
            pendingRequests.delete(approveConnectId);
            sendResponse({ error: 'Request expired' });
            return;
          }

          // Add origin to approved list
          await approveOrigin(connectRequest.origin);

          // Return address
          const connectAddress = vault.getAddress();
          approveConnectPending.sendResponse([connectAddress]);
          pendingRequests.delete(approveConnectId);
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
          rejectConnectPending.sendResponse({
            error: { code: 4001, message: 'User rejected the connection' },
          });
          pendingRequests.delete(rejectConnectId);
          processNextRequest();
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.GET_PENDING_RAW_TX_REQUEST:
        const getPendingRawTxId = payload.params?.[0];
        const rawTxPending = pendingRequests.get(getPendingRawTxId);

        // Helper to check if request is SignRawTxRequest
        const isSignRawTxRequestForGet = (req: any): req is SignRawTxRequest => {
          return 'rawTx' in req && 'notes' in req && 'spendConditions' in req;
        };

        if (rawTxPending && isSignRawTxRequestForGet(rawTxPending.request)) {
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
          console.log('[Background] Estimating transaction fee via vault:', {
            to: estimateTo.slice(0, 20) + '...',
            amount: estimateAmount,
          });

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

      case INTERNAL_METHODS.BUILD_AND_SIGN_TRANSACTION:
        // params: [to, amount, fee] - amount and fee in nicks
        // Called from popup SendReview screen - builds and signs transaction without broadcasting
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const [buildTo, buildAmount, buildFee] = payload.params || [];
        if (!isNockAddress(buildTo)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }

        if (typeof buildAmount !== 'number' || buildAmount <= 0) {
          sendResponse({ error: 'Invalid amount' });
          return;
        }

        if (typeof buildFee !== 'number' || buildFee < 0) {
          sendResponse({ error: 'Invalid fee' });
          return;
        }

        try {
          console.log('[Background] Building and signing transaction:', {
            to: buildTo.slice(0, 20) + '...',
            amount: buildAmount,
            fee: buildFee,
          });

          const result = await vault.buildAndSignTransaction(buildTo, buildAmount, buildFee);

          if ('error' in result) {
            console.error('[Background] Build failed:', result.error);
            sendResponse({ error: result.error });
            return;
          }

          console.log('[Background] Transaction built and signed:', result.txId);
          sendResponse({
            txid: result.txId,
            protobufTx: result.protobufTx,
            jammedTx: btoa(String.fromCharCode(...result.jammedTx)),
          });
        } catch (error) {
          console.error('[Background] Build and sign failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Build and sign failed',
          });
        }
        return;

      case INTERNAL_METHODS.BROADCAST_TRANSACTION:
        // params: [protobufTx] - protobuf transaction object (not WASM)
        // Called from popup after building and signing the transaction
        const [protobufTx] = payload.params || [];

        if (!protobufTx) {
          sendResponse({ error: 'Missing transaction' });
          return;
        }

        try {
          console.log('[Background] Broadcasting transaction...');

          const result = await vault.broadcastTransaction(protobufTx);

          if ('error' in result) {
            console.error('[Background] Broadcast failed:', result.error);
            sendResponse({ error: result.error });
            return;
          }

          console.log('[Background] Transaction broadcasted successfully:', result.txId);
          sendResponse({
            txid: result.txId,
            broadcasted: result.broadcasted,
          });
        } catch (error) {
          console.error('[Background] Broadcast failed:', error);
          sendResponse({
            error: error instanceof Error ? error.message : 'Broadcast failed',
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
          console.log('[Background] Sending transaction:', {
            to: sendTo.slice(0, 20) + '...',
            amount: sendAmount,
            fee: sendFee,
          });

          const result = await vault.sendTransaction(sendTo, sendAmount, sendFee);

          if ('error' in result) {
            console.error('[Background] Transaction failed:', result.error);
            sendResponse({ error: result.error });
            return;
          }

          console.log('[Background] Transaction sent successfully:', result.txId);
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
