import { PROVIDER_METHODS } from './constants';

export const SIDE_PANEL_DEFAULT_PATH = 'sidepanel/index.html';

/** Provider methods that may surface an approval UI. */
export const APPROVAL_PROVIDER_METHODS = new Set<string>([
  PROVIDER_METHODS.CONNECT,
  PROVIDER_METHODS.SIGN_MESSAGE,
  PROVIDER_METHODS.SEND_TRANSACTION,
  PROVIDER_METHODS.SIGN_TX,
]);
