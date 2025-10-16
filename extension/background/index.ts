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
  (async () => {
    const { payload } = msg || {};
    touchActivity(payload?.method);

    // Guard: internal methods (wallet:*) can only be called from popup/extension pages
    if (payload?.method?.startsWith("wallet:") && !isFromPopup(_sender)) {
      return sendResponse({ error: ERROR_CODES.UNAUTHORIZED });
    }

    switch (payload?.method) {
      // Provider methods (called from injected provider via content script)
      case PROVIDER_METHODS.REQUEST_ACCOUNTS:
        if (vault.isLocked()) {
          return sendResponse({ error: ERROR_CODES.LOCKED });
        }
        return sendResponse([vault.getAddress()]);

      case PROVIDER_METHODS.SIGN_MESSAGE:
        if (vault.isLocked()) {
          return sendResponse({ error: ERROR_CODES.LOCKED });
        }
        return sendResponse({
          signature: await vault.signMessage(payload.params),
        });

      case PROVIDER_METHODS.SEND_TRANSACTION:
        if (vault.isLocked()) {
          return sendResponse({ error: ERROR_CODES.LOCKED });
        }
        const { to, amount, fee } = payload.params?.[0] ?? {};
        if (!isNockAddress(to)) {
          return sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
        }
        // TODO: Implement real transaction signing and RPC broadcast to Nockchain network
        // For now, return a generated transaction ID until WASM signing and RPC are integrated
        return sendResponse({
          txid: crypto.randomUUID(),
          amount,
          fee,
        });

      // Internal methods (called from popup)
      case INTERNAL_METHODS.SET_AUTO_LOCK:
        autoLockMinutes = payload.params?.[0] ?? 15;
        await chrome.storage.local.set({
          [STORAGE_KEYS.AUTO_LOCK_MINUTES]: autoLockMinutes,
        });
        scheduleAlarm();
        return sendResponse({ ok: true });

      case INTERNAL_METHODS.UNLOCK:
        return sendResponse(await vault.unlock(payload.params?.[0])); // password

      case INTERNAL_METHODS.LOCK:
        await vault.lock();
        return sendResponse({ ok: true });

      case INTERNAL_METHODS.SETUP:
        // params: password, mnemonic (optional). If no mnemonic, generates one automatically.
        return sendResponse(
          await vault.setup(payload.params?.[0], payload.params?.[1])
        );

      case INTERNAL_METHODS.GET_STATE:
        return sendResponse({
          locked: vault.isLocked(),
          address: await vault.getAddressSafe(),
          accounts: vault.getAccounts(),
          currentAccount: vault.getCurrentAccount(),
        });

      case INTERNAL_METHODS.GET_ACCOUNTS:
        return sendResponse({
          accounts: vault.getAccounts(),
          currentAccount: vault.getCurrentAccount(),
        });

      case INTERNAL_METHODS.SWITCH_ACCOUNT:
        return sendResponse(await vault.switchAccount(payload.params?.[0]));

      case INTERNAL_METHODS.RENAME_ACCOUNT:
        return sendResponse(
          await vault.renameAccount(payload.params?.[0], payload.params?.[1])
        );

      case INTERNAL_METHODS.CREATE_ACCOUNT:
        // params: name (optional)
        return sendResponse(await vault.createAccount(payload.params?.[0]));

      case INTERNAL_METHODS.GET_MNEMONIC:
        // params: password (required for verification)
        return sendResponse(await vault.getMnemonic(payload.params?.[0]));

      case INTERNAL_METHODS.GET_AUTO_LOCK:
        return sendResponse({ minutes: autoLockMinutes });

      case INTERNAL_METHODS.GET_BALANCE:
        // TODO: Query blockchain for balance when WASM bindings are ready
        return sendResponse({ balance: 0 });

      default:
        return sendResponse({ error: ERROR_CODES.METHOD_NOT_SUPPORTED });
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
