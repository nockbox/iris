/**
 * Content Script: Bridge between page and service worker
 * Relays messages between the inpage provider (running in MAIN world) and the service worker
 *
 * Note: The inpage provider is injected separately via manifest.json with "world": "MAIN"
 */

import { MESSAGE_TARGETS, RUNTIME_MESSAGE_TYPES } from '../shared/constants';

type BridgeRequest = {
  target: string;
  id: string;
  payload: {
    method: string;
    params?: unknown;
    api?: unknown;
    timeout?: unknown;
  };
};

function isBridgeRequest(data: unknown): data is BridgeRequest {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const request = data as Record<string, unknown>;
  const payload = request.payload;
  return (
    request.target === MESSAGE_TARGETS.WALLET_BRIDGE &&
    typeof request.id === 'string' &&
    request.id.length > 0 &&
    request.id.length <= 128 &&
    !Object.prototype.hasOwnProperty.call(request, 'reply') &&
    Boolean(payload) &&
    typeof payload === 'object' &&
    typeof (payload as Record<string, unknown>).method === 'string'
  );
}

/**
 * Bridge page <-> Service Worker
 * Listens for messages from the injected provider and forwards to SW
 */
window.addEventListener('message', async (evt: MessageEvent) => {
  const data = evt.data;

  // Filter messages: must be for us and from the page
  if (evt.source !== window || !isBridgeRequest(data)) {
    return;
  }

  let reply: unknown;
  try {
    reply = await chrome.runtime.sendMessage(data);
  } catch (error) {
    reply = {
      error: {
        code: 4900,
        message: error instanceof Error ? error.message : 'Wallet extension is unavailable',
      },
    };
  }

  const responseMessage = {
    target: MESSAGE_TARGETS.WALLET_BRIDGE,
    id: data.id,
    reply,
  };

  window.postMessage(responseMessage, window.location.origin);
});

/**
 * Listen for wallet events from background script and relay to page
 * These are emitted when wallet state changes (account switch, lock, etc.)
 */
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === RUNTIME_MESSAGE_TYPES.REQUESTER_PING) {
    _sendResponse({ ok: true });
    return;
  }

  // Only handle wallet events
  if (message.type !== 'WALLET_EVENT') {
    return;
  }

  // Relay advisory state notifications. Page scripts can forge same-window
  // events, so dApps must re-query authoritative state through the provider.
  window.postMessage(
    {
      __iris: true,
      type: `nockchain_${message.eventType}`,
      data: message.data,
    },
    window.location.origin
  );
});
