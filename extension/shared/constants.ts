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

  /** Update account styling (icon and color) */
  UPDATE_ACCOUNT_STYLING: "wallet:updateAccountStyling",

  /** Get mnemonic phrase (requires password verification) */
  GET_MNEMONIC: "wallet:getMnemonic",

  /** Get auto-lock timeout setting */
  GET_AUTO_LOCK: "wallet:getAutoLock",

  /** Get wallet balance from blockchain */
  GET_BALANCE: "wallet:getBalance",

  /** Get pending transaction request for approval */
  GET_PENDING_TRANSACTION: "wallet:getPendingTransaction",

  /** Add a transaction to the cache */
  ADD_TRANSACTION_TO_CACHE: "wallet:addTransactionToCache",

  /** Get cached transactions for current account */
  GET_CACHED_TRANSACTIONS: "wallet:getCachedTransactions",

  /** Check if cache should be refreshed */
  SHOULD_REFRESH_CACHE: "wallet:shouldRefreshCache",

  /** Approve pending transaction request */
  APPROVE_TRANSACTION: "wallet:approveTransaction",

  /** Reject pending transaction request */
  REJECT_TRANSACTION: "wallet:rejectTransaction",

  /** Get pending sign message request for approval */
  GET_PENDING_SIGN_REQUEST: "wallet:getPendingSignRequest",

  /** Approve pending sign message request */
  APPROVE_SIGN_MESSAGE: "wallet:approveSignMessage",

  /** Reject pending sign message request */
  REJECT_SIGN_MESSAGE: "wallet:rejectSignMessage",

  /** Get pending connection request for approval */
  GET_PENDING_CONNECTION: "wallet:getPendingConnection",

  /** Approve pending connection request */
  APPROVE_CONNECTION: "wallet:approveConnection",

  /** Reject pending connection request */
  REJECT_CONNECTION: "wallet:rejectConnection",

  /** Revoke origin permissions */
  REVOKE_ORIGIN: "wallet:revokeOrigin",
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

  /** Invalid account index provided */
  INVALID_ACCOUNT_INDEX: "INVALID_ACCOUNT_INDEX",

  /** Unsupported RPC method requested */
  METHOD_NOT_SUPPORTED: "METHOD_NOT_SUPPORTED",

  /** Unauthorized: internal methods can only be called from popup/extension pages */
  UNAUTHORIZED: "UNAUTHORIZED",

  /** Requested resource not found (e.g., pending approval request) */
  NOT_FOUND: "NOT_FOUND",

  /** Invalid parameters provided to method */
  INVALID_PARAMS: "INVALID_PARAMS",
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

  /** Auto-lock timeout in minutes */
  AUTO_LOCK_MINUTES: "autoLockMinutes",

  /** Onboarding state - tracks whether seed phrase backup is complete */
  ONBOARDING_STATE: "onboardingState",

  /** Array of approved origins (websites that can access wallet) */
  APPROVED_ORIGINS: "approvedOrigins",

  /** Cached transaction history per account address */
  TRANSACTION_CACHE: "transactionCache",

  /** Last transaction sync timestamp per account address */
  LAST_TX_SYNC: "lastTxSync",
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
 * Nockchain Currency Conversion
 */
/** Conversion rate: 1 NOCK = 65,536 nicks (2^16) */
export const NOCK_TO_NICKS = 65_536;

/** Default transaction fee in nicks (32,768 nicks = 0.5 NOCK) */
export const DEFAULT_TRANSACTION_FEE = 32_768;

/**
 * User Activity Methods - Methods that count as user activity for auto-lock timer
 * Only these methods reset the lastActivity timestamp. Passive/polling methods
 * (like GET_STATE, GET_ACCOUNTS, etc.) do NOT reset the timer.
 */
export const USER_ACTIVITY_METHODS = new Set([
  // Provider methods (user-initiated actions from dApps)
  PROVIDER_METHODS.REQUEST_ACCOUNTS,
  PROVIDER_METHODS.SIGN_MESSAGE,
  PROVIDER_METHODS.SEND_TRANSACTION,

  // Internal methods (user actions in the UI)
  INTERNAL_METHODS.UNLOCK,
  INTERNAL_METHODS.SWITCH_ACCOUNT,
  INTERNAL_METHODS.CREATE_ACCOUNT,
  INTERNAL_METHODS.RENAME_ACCOUNT,
  INTERNAL_METHODS.UPDATE_ACCOUNT_STYLING,
  INTERNAL_METHODS.SET_AUTO_LOCK,
  INTERNAL_METHODS.GET_MNEMONIC, // Viewing recovery phrase is user activity
]);

/**
 * UI Constants - Dimensions and constraints
 */
export const UI_CONSTANTS = {
  /** Extension popup width in pixels */
  POPUP_WIDTH: 357,
  /** Extension popup height in pixels */
  POPUP_HEIGHT: 600,
  /** Approval popup top offset in pixels */
  POPUP_TOP_OFFSET: 40,
  /** Approval popup right offset in pixels */
  POPUP_RIGHT_OFFSET: 20,
  /** Wallet state polling interval in milliseconds */
  STATE_POLL_INTERVAL: 2000,
  /** Minimum password length */
  MIN_PASSWORD_LENGTH: 8,
  /** Number of words in BIP-39 mnemonic */
  MNEMONIC_WORD_COUNT: 24,
} as const;

/**
 * Approval Request Constants - URL hash prefixes for approval flows
 */
export const APPROVAL_CONSTANTS = {
  /** Hash prefix for connection approval requests */
  CONNECT_HASH_PREFIX: 'connect-approval-',
  /** Hash prefix for transaction approval requests */
  TRANSACTION_HASH_PREFIX: 'transaction-approval-',
  /** Hash prefix for sign message approval requests */
  SIGN_MESSAGE_HASH_PREFIX: 'sign-message-approval-',
} as const;
