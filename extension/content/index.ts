/**
 * Content Script: Bridge between page and service worker
 * Relays messages between the inpage provider (running in MAIN world) and the service worker
 *
 * Note: The inpage provider is injected separately via manifest.json with "world": "MAIN"
 */

import { MESSAGE_TARGETS } from '../shared/constants';
import {
  APPROVAL_PROVIDER_METHODS,
  openSidePanelFromUserGesture,
} from '../shared/side-panel';

function getProviderMethod(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('method' in payload)) {
    return undefined;
  }

  const method = (payload as { method?: unknown }).method;
  return typeof method === 'string' ? method : undefined;
}

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

  const method = getProviderMethod(data.payload);
  if (method && APPROVAL_PROVIDER_METHODS.has(method)) {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await openSidePanelFromUserGesture(tab.id);
      }
    } catch (error) {
      console.warn('[Iris] Failed to open side panel before provider request:', error);
    }
  }

  // Forward to service worker and relay response back to page
  const reply = await chrome.runtime.sendMessage(data);

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
