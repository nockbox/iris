/**
 * Application Constants
 * Defines all method names, error codes, storage keys, and other constants
 * for wallet provider API and internal extension communication
 */

/**
 * Public Provider Methods - Called by websites/dapps via window.nockchain
 * Follow EIP-1193 naming convention with 'nock_' prefix
 */
export const PROVIDER_METHODS = {
  /** Request user's wallet accounts */
  REQUEST_ACCOUNTS: "nock_requestAccounts",

  /** Sign an arbitrary message */
  SIGN_MESSAGE: "nock_signMessage",

  /** Sign and send a transaction */
  SEND_TRANSACTION: "nock_sendTransaction",
} as const;

/**
 * Internal Extension Methods - Called by popup UI and other extension components
 * Use 'wallet:' prefix to distinguish from public provider methods
 */
export const INTERNAL_METHODS = {
  /** Get current wallet state */
  GET_STATE: "wallet:getState",

  /** Unlock the wallet with password */
  UNLOCK: "wallet:unlock",

  /** Lock the wallet */
  LOCK: "wallet:lock",

  /** Setup/create a new wallet */
  SETUP: "wallet:setup",

  /** Set auto-lock timeout in minutes */
  SET_AUTO_LOCK: "wallet:setAutoLock",

  /** Create a new account */
  CREATE_ACCOUNT: "wallet:createAccount",

  /** Switch to a different account */
  SWITCH_ACCOUNT: "wallet:switchAccount",

  /** Get all accounts */
  GET_ACCOUNTS: "wallet:getAccounts",

  /** Rename an account */
  RENAME_ACCOUNT: "wallet:renameAccount",
} as const;

/**
 * All RPC methods (combined)
 */
export const RPC_METHODS = {
  ...PROVIDER_METHODS,
  ...INTERNAL_METHODS,
} as const;

/**
 * Error Codes - Used in API error responses
 */
export const ERROR_CODES = {
  /** Wallet is locked, user needs to unlock */
  LOCKED: "LOCKED",

  /** No vault exists, user needs to create wallet */
  NO_VAULT: "NO_VAULT",

  /** Incorrect password provided */
  BAD_PASSWORD: "BAD_PASSWORD",

  /** Invalid address format */
  BAD_ADDRESS: "BAD_ADDRESS",

  /** Invalid mnemonic phrase provided */
  INVALID_MNEMONIC: "INVALID_MNEMONIC",

  /** Unsupported RPC method requested */
  METHOD_NOT_SUPPORTED: "METHOD_NOT_SUPPORTED",
} as const;

/**
 * Chrome Storage Keys - Keys used for chrome.storage.local
 */
export const STORAGE_KEYS = {
  /** Encrypted mnemonic data (iv, ct, salt) */
  ENCRYPTED_VAULT: "enc",

  /** Array of accounts with name, address, and derivation index */
  ACCOUNTS: "accounts",

  /** Current active account index */
  CURRENT_ACCOUNT_INDEX: "currentAccountIndex",
} as const;

/**
 * Chrome Alarm Names - Named alarms for scheduled tasks
 */
export const ALARM_NAMES = {
  /** Auto-lock timeout alarm */
  AUTO_LOCK: "autoLock",
} as const;

/**
 * Message Targets - Used for window.postMessage routing
 */
export const MESSAGE_TARGETS = {
  /** Target identifier for wallet bridge messages */
  WALLET_BRIDGE: "FORT_NOCK",
} as const;

/**
 * Configuration - Default settings
 */
/** Default auto-lock timeout in minutes */
export const AUTOLOCK_MINUTES = 15;

/**
 * UI Constants - Dimensions and constraints
 */
export const UI_CONSTANTS = {
  /** Extension popup width in pixels */
  POPUP_WIDTH: 357,
  /** Extension popup height in pixels */
  POPUP_HEIGHT: 600,
  /** Minimum password length */
  MIN_PASSWORD_LENGTH: 8,
  /** Number of words in BIP-39 mnemonic */
  MNEMONIC_WORD_COUNT: 24,
} as const;
