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
} from "../shared/constants";

const vault = new Vault();
let lastActivity = Date.now();
let autoLockMinutes = AUTOLOCK_MINUTES;

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

// Initialize auto-lock setting and schedule alarm
(async () => {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.AUTO_LOCK_MINUTES,
  ]);
  autoLockMinutes = stored[STORAGE_KEYS.AUTO_LOCK_MINUTES] ?? AUTOLOCK_MINUTES;
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
 * Content scripts have sender.tab set; popup/options pages don't
 */
function isFromPopup(sender: chrome.runtime.MessageSender): boolean {
  return !sender.tab;
}

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log('[Background] Received message:', msg);
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
          console.log('[Background] Vault is locked, sending error');
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        const address = vault.getAddress();
        console.log('[Background] Sending account:', address);
        sendResponse([address]);

        // Emit connect event when dApp connects successfully
        await emitWalletEvent('connect', { chainId: 'nockchain-1' });
        return;

      case PROVIDER_METHODS.SIGN_MESSAGE:
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        sendResponse({
          signature: await vault.signMessage(payload.params),
        });
        return;

      case PROVIDER_METHODS.SEND_TRANSACTION:
        if (vault.isLocked()) {
          sendResponse({ error: ERROR_CODES.LOCKED });
          return;
        }
        const { to, amount, fee } = payload.params?.[0] ?? {};
        if (!isNockAddress(to)) {
          sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
          return;
        }
        // TODO: Implement real transaction signing and RPC broadcast to Nockchain network
        // For now, return a generated transaction ID until WASM signing and RPC are integrated
        sendResponse({
          txid: crypto.randomUUID(),
          amount,
          fee,
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
