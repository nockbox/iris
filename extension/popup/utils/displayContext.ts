import type { Screen } from '../store';

/** Whether the wallet UI is running in the Chrome side panel. */
export function isSidePanel(): boolean {
  return window.location.pathname.includes('sidepanel');
}

/** Close an approval flow: dismiss popup window or return home in the side panel. */
export function closeAfterApproval(navigate: (screen: Screen) => void): void {
  if (isSidePanel()) {
    navigate('home');
  } else {
    window.close();
  }
}

/** Whether the side panel API is available in this browser. */
export function isSidePanelSupported(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.sidePanel);
}
