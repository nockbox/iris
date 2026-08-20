import { describe, expect, it, vi } from 'vitest';

vi.mock('@nockbox/iris-sdk', () => ({
  PROVIDER_METHODS: {
    CONNECT: 'nock_connect',
    SIGN_MESSAGE: 'nock_signMessage',
    SEND_TRANSACTION: 'nock_sendTransaction',
    SIGN_TX: 'nock_signTx',
    GET_WALLET_INFO: 'nock_getWalletInfo',
  },
}));

import { DISPLAY_MODES, PROVIDER_METHODS } from './constants';
import { isSidePanelGestureRequest } from './side-panel';

function request(method: string, displayMode: unknown) {
  return {
    payload: { method },
    runtimeContext: { displayMode },
  };
}

describe('side panel gesture routing', () => {
  it('opens approval requests when the content script confirms side-panel mode', () => {
    expect(
      isSidePanelGestureRequest(request(PROVIDER_METHODS.CONNECT, DISPLAY_MODES.SIDE_PANEL))
    ).toBe(true);
  });

  it('does not open the side panel for popup-mode users after a cold worker start', () => {
    expect(isSidePanelGestureRequest(request(PROVIDER_METHODS.CONNECT, DISPLAY_MODES.POPUP))).toBe(
      false
    );
  });

  it('fails closed until the content-script mode cache is initialized', () => {
    expect(isSidePanelGestureRequest(request(PROVIDER_METHODS.CONNECT, null))).toBe(false);
    expect(isSidePanelGestureRequest({ payload: { method: PROVIDER_METHODS.CONNECT } })).toBe(
      false
    );
  });

  it('ignores page-controlled display mode fields outside runtime context', () => {
    expect(
      isSidePanelGestureRequest({
        payload: {
          method: PROVIDER_METHODS.CONNECT,
          displayMode: DISPLAY_MODES.SIDE_PANEL,
        },
      })
    ).toBe(false);
  });

  it('does not open for provider methods without an approval UI', () => {
    expect(
      isSidePanelGestureRequest(request(PROVIDER_METHODS.GET_WALLET_INFO, DISPLAY_MODES.SIDE_PANEL))
    ).toBe(false);
    expect(
      isSidePanelGestureRequest(
        request(PROVIDER_METHODS.BUILD_SIMPLE_TRANSACTION, DISPLAY_MODES.SIDE_PANEL)
      )
    ).toBe(false);
  });
});
