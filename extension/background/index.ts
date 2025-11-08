/**
 * Service Worker: Wallet controller and message router
 * Handles provider requests from content script and popup UI
 */

import { Vault } from "../shared/vault";
import { isNockAddress } from "../shared/validators";
import {
  PROVIDER_METHODS,
  INTERNAL_METHODS,
  ERROR_CODES,
  ALARM_NAMES,
  AUTOLOCK_MINUTES,
  STORAGE_KEYS,
  USER_ACTIVITY_METHODS,
  DEFAULT_TRANSACTION_FEE,
  UI_CONSTANTS,
  APPROVAL_CONSTANTS,
} from "../shared/constants";
import type {
  TransactionRequest,
  SignRequest,
  ConnectRequest,
} from "../shared/types";

const vault = new Vault();
let lastActivity = Date.now();
let autoLockMinutes = AUTOLOCK_MINUTES;

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
}

const pendingRequests = new Map<string, PendingRequest>();

/**
 * Type guard to check if a request is a ConnectRequest
 */
function isConnectRequest(request: TransactionRequest | SignRequest | ConnectRequest): request is ConnectRequest {
  return 'timestamp' in request && !('message' in request) && !('to' in request);
}

/**
 * Type guard to check if a request is a SignRequest
 */
function isSignRequest(request: TransactionRequest | SignRequest | ConnectRequest): request is SignRequest {
  return 'message' in request;
}

/**
 * Type guard to check if a request is a TransactionRequest
 */
function isTransactionRequest(request: TransactionRequest | SignRequest | ConnectRequest): request is TransactionRequest {
  return 'to' in request;
}

/**
 * Create an approval popup window
 */
async function createApprovalPopup(requestId: string, type: 'connect' | 'transaction' | 'sign-message') {
  let hashPrefix: string;
  if (type === 'connect') {
    hashPrefix = APPROVAL_CONSTANTS.CONNECT_HASH_PREFIX;
  } else if (type === 'transaction') {
    hashPrefix = APPROVAL_CONSTANTS.TRANSACTION_HASH_PREFIX;
  } else {
    hashPrefix = APPROVAL_CONSTANTS.SIGN_MESSAGE_HASH_PREFIX;
  }
  const popupUrl = chrome.runtime.getURL(`popup/index.html#${hashPrefix}${requestId}`);

  // Get the last focused window to position the popup relative to it
  const currentWindow = await chrome.windows.getLastFocused();

  // Calculate position for top-right area
  const width = UI_CONSTANTS.POPUP_WIDTH;
  const height = UI_CONSTANTS.POPUP_HEIGHT;

  // Position in top-right of the current window, with some padding
  // If window dimensions aren't available, use reasonable defaults
  const left = currentWindow.left !== undefined && currentWindow.width !== undefined
    ? currentWindow.left + currentWindow.width - width - UI_CONSTANTS.POPUP_RIGHT_OFFSET
    : undefined; // Let Chrome position it
  const top = currentWindow.top !== undefined
    ? currentWindow.top + UI_CONSTANTS.POPUP_TOP_OFFSET
    : undefined; // Let Chrome position it

  await chrome.windows.create({
    url: popupUrl,
    type: 'popup',
    width,
    height,
    left,
    top,
    focused: true,
  });
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

// Initialize auto-lock setting, load approved origins, and schedule alarm
(async () => {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.AUTO_LOCK_MINUTES,
  ]);
  autoLockMinutes = stored[STORAGE_KEYS.AUTO_LOCK_MINUTES] ?? AUTOLOCK_MINUTES;
  await loadApprovedOrigins();
  scheduleAlarm();
})();

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
    if (payload?.method?.startsWith("wallet:") && !isFromPopup(_sender)) {
      sendResponse({ error: ERROR_CODES.UNAUTHORIZED });
      return;
    }

    switch (payload?.method) {
      // Provider methods (called from injected provider via content script)
      case PROVIDER_METHODS.REQUEST_ACCOUNTS:
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }

        const requestAccountsOrigin = _sender.url || _sender.origin || '';

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
        const { to, amount, fee = DEFAULT_TRANSACTION_FEE } = payload.params?.[0] ?? {};
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
          await emitWalletEvent('connect', { chainId: 'nockchain-1' });
        }
        return;

      case INTERNAL_METHODS.LOCK:
        await vault.lock();
        sendResponse({ ok: true });

        // Emit disconnect event when wallet locks
        await emitWalletEvent('disconnect', { code: 1013, message: 'Wallet locked' });
        return;

      case INTERNAL_METHODS.SETUP:
        // params: password, mnemonic (optional). If no mnemonic, generates one automatically.
        sendResponse(
          await vault.setup(payload.params?.[0], payload.params?.[1])
        );
        return;

      case INTERNAL_METHODS.GET_STATE:
        sendResponse({
          locked: vault.isLocked(),
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
        sendResponse(
          await vault.renameAccount(payload.params?.[0], payload.params?.[1])
        );
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
        // TODO: Query blockchain for balance when WASM bindings are ready
        sendResponse({ balance: 0 });
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
            sendResponse({ success: true });
          } catch (error) {
            console.error('Transaction signing failed:', error);
            approveTxPending.sendResponse({
              error: { code: 4900, message: error instanceof Error ? error.message : 'Transaction signing failed' },
            });
            pendingRequests.delete(approveTxId);
            sendResponse({ error: error instanceof Error ? error.message : 'Transaction signing failed' });
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

          const signature = await vault.signMessage([signRequest.message]);
          approveSignPending.sendResponse({ signature });
          pendingRequests.delete(approveSignId);
          sendResponse({ success: true });
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
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.NOT_FOUND });
        }
        return;

      case INTERNAL_METHODS.REVOKE_ORIGIN:
        const revokeOriginParam = payload.params?.[0];
        if (revokeOriginParam && typeof revokeOriginParam === 'object' && 'origin' in revokeOriginParam) {
          await revokeOrigin(revokeOriginParam.origin as string);
          sendResponse({ success: true });
        } else {
          sendResponse({ error: ERROR_CODES.INVALID_PARAMS });
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
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAMES.AUTO_LOCK) return;

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
