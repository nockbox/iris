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
} from "../shared/constants";

const vault = new Vault();
let lastActivity = Date.now();
let autoLockMinutes = AUTOLOCK_MINUTES;

// Schedule auto-lock alarm
scheduleAlarm();

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    lastActivity = Date.now();
    const { payload } = msg || {};

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
        const { to } = payload.params ?? {};
        if (!isNockAddress(to)) {
          return sendResponse({ error: ERROR_CODES.BAD_ADDRESS });
        }
        // TODO: Implement real transaction signing and RPC broadcast to Nockchain network
        // For now, return a generated transaction ID until WASM signing and RPC are integrated
        return sendResponse({
          txid: crypto.randomUUID(),
        });

      // Internal methods (called from popup)
      case INTERNAL_METHODS.SET_AUTO_LOCK:
        autoLockMinutes = payload.params?.[0] ?? 15;
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
        return sendResponse(await vault.renameAccount(payload.params?.[0], payload.params?.[1]));

      case INTERNAL_METHODS.CREATE_ACCOUNT:
        // params: name (optional)
        return sendResponse(await vault.createAccount(payload.params?.[0]));

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
