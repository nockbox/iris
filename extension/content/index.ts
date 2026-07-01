/**
 * Content Script: Bridge between page and service worker
 * Relays messages between the inpage provider (running in MAIN world) and the service worker
 *
 * Note: The inpage provider is injected separately via manifest.json with "world": "MAIN"
 */

import { MESSAGE_TARGETS } from '../shared/constants';

/**
 * Bridge page <-> Service Worker
 * Listens for messages from the injected provider and forwards to SW
 */
window.addEventListener('message', async (evt: MessageEvent) => {
  const data = evt.data;

  // Filter messages: must be for us and from the page
  if (!data || data.target !== MESSAGE_TARGETS.WALLET_BRIDGE || evt.source !== window) {
    return;
  }

  // Only forward request messages (with payload), not reply messages
  if (!data.payload || data.reply !== undefined) {
    return;
  }

  // Forward to service worker and relay response back to page.
  // If the service worker was reloaded/unavailable, still answer the page so
  // callers get the bridge error instead of timing out with no details.
  let reply: unknown;
  try {
    reply = await chrome.runtime.sendMessage(data);
  } catch (error) {
    reply = {
      error: {
        code: -32603,
        message:
          error instanceof Error ? error.message : `Iris extension bridge failed: ${String(error)}`,
      },
    };
  }

  const responseMessage = {
    target: MESSAGE_TARGETS.WALLET_BRIDGE,
    id: data.id,
    reply,
  };

  window.postMessage(responseMessage, '*');
});

/**
 * Listen for wallet events from background script and relay to page
 * These are emitted when wallet state changes (account switch, lock, etc.)
 */
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  // Only handle wallet events
  if (message.type !== 'WALLET_EVENT') {
    return;
  }

  // Relay to page with __iris brand for security
  // This prevents malicious scripts from forging wallet events
  window.postMessage(
    {
      __iris: true,
      type: `nockchain_${message.eventType}`,
      data: message.data,
    },
    '*'
  );
});
