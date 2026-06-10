import { DISPLAY_MODES, PROVIDER_METHODS, STORAGE_KEYS } from './constants';

export const SIDE_PANEL_DEFAULT_PATH = 'sidepanel/index.html';

/** Provider methods that may surface an approval UI. */
export const APPROVAL_PROVIDER_METHODS = new Set<string>([
  PROVIDER_METHODS.CONNECT,
  PROVIDER_METHODS.SIGN_MESSAGE,
  PROVIDER_METHODS.SEND_TRANSACTION,
  PROVIDER_METHODS.SIGN_TX,
]);

export async function isSidePanelDisplayMode(): Promise<boolean> {
  if (!chrome.sidePanel) {
    return false;
  }

  const stored = await chrome.storage.local.get([STORAGE_KEYS.DISPLAY_MODE]);
  return stored[STORAGE_KEYS.DISPLAY_MODE] === DISPLAY_MODES.SIDE_PANEL;
}

/** Open the wallet side panel while the user-gesture chain is still active. */
export async function openSidePanelFromUserGesture(tabId: number): Promise<void> {
  if (!chrome.sidePanel) {
    return;
  }

  if (!(await isSidePanelDisplayMode())) {
    return;
  }

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: SIDE_PANEL_DEFAULT_PATH,
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId });
  } catch (error) {
    console.warn('[Iris] sidePanel.open from user gesture failed:', error);
  }
}
