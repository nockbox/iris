import { DISPLAY_MODES, PROVIDER_METHODS } from './constants';

export const SIDE_PANEL_DEFAULT_PATH = 'sidepanel/index.html';

/** Legacy API 0 raw-signing method, mapped to SIGN_TX at the RPC boundary. */
export const LEGACY_SIGN_RAW_TX_METHOD = 'nock_signRawTx';

/** Provider methods that may surface an approval UI. */
export const APPROVAL_PROVIDER_METHODS = new Set<string>([
  PROVIDER_METHODS.CONNECT,
  PROVIDER_METHODS.SIGN_MESSAGE,
  PROVIDER_METHODS.SEND_TRANSACTION,
  PROVIDER_METHODS.SIGN_TX,
  LEGACY_SIGN_RAW_TX_METHOD,
]);

export function isApprovalProviderMethod(method: unknown): method is string {
  return typeof method === 'string' && APPROVAL_PROVIDER_METHODS.has(method);
}

/**
 * Runtime-only context added by the isolated content script. The page cannot
 * supply this value because the content script rebuilds the message envelope
 * before forwarding it to the service worker.
 */
export function isSidePanelGestureRequest(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const request = message as {
    payload?: { method?: unknown };
    runtimeContext?: { displayMode?: unknown };
  };

  return (
    request.runtimeContext?.displayMode === DISPLAY_MODES.SIDE_PANEL &&
    isApprovalProviderMethod(request.payload?.method)
  );
}
