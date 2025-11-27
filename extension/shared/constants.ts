/**
 * Application Constants
 * Defines all method names, error codes, storage keys, and other constants
 * for wallet provider API and internal extension communication
 */

// Import provider methods from SDK
import { PROVIDER_METHODS } from '@nockbox/iris-sdk';

/**
 * Internal Extension Methods - Called by popup UI and other extension components
 * Use 'wallet:' prefix to distinguish from public provider methods
 */
export const INTERNAL_METHODS = {
  /** Get current wallet state */
  GET_STATE: 'wallet:getState',

  /** Unlock the wallet with password */
  UNLOCK: 'wallet:unlock',

  /** Lock the wallet */
  LOCK: 'wallet:lock',

  /** Reset/delete the wallet (clears all data) */
  RESET_WALLET: 'wallet:resetWallet',

  /** Setup/create a new wallet */
  SETUP: 'wallet:setup',

  /** Set auto-lock timeout in minutes */
  SET_AUTO_LOCK: 'wallet:setAutoLock',

  /** Create a new account */
  CREATE_ACCOUNT: 'wallet:createAccount',

  /** Switch to a different account */
  SWITCH_ACCOUNT: 'wallet:switchAccount',

  /** Get all accounts */
  GET_ACCOUNTS: 'wallet:getAccounts',

  /** Rename an account */
  RENAME_ACCOUNT: 'wallet:renameAccount',

  /** Update account styling (icon and color) */
  UPDATE_ACCOUNT_STYLING: 'wallet:updateAccountStyling',

  /** Hide an account from the UI */
  HIDE_ACCOUNT: 'wallet:hideAccount',

  /** Get mnemonic phrase (requires password verification) */
  GET_MNEMONIC: 'wallet:getMnemonic',

  /** Get auto-lock timeout setting */
  GET_AUTO_LOCK: 'wallet:getAutoLock',

  /** Get wallet balance from blockchain */
  GET_BALANCE: 'wallet:getBalance',

  /** Get balance from UTXO store (excludes in-flight notes) */
  GET_BALANCE_FROM_STORE: 'wallet:getBalanceFromStore',

  /** Get RPC connection status */
  GET_CONNECTION_STATUS: 'wallet:getConnectionStatus',

  /** Report RPC connection status from popup (where gRPC calls happen) */
  REPORT_RPC_STATUS: 'wallet:reportRpcStatus',

  /** Get pending transaction request for approval */
  GET_PENDING_TRANSACTION: 'wallet:getPendingTransaction',

  /** Approve pending transaction request */
  APPROVE_TRANSACTION: 'wallet:approveTransaction',

  /** Reject pending transaction request */
  REJECT_TRANSACTION: 'wallet:rejectTransaction',

  /** Get pending sign message request for approval */
  GET_PENDING_SIGN_REQUEST: 'wallet:getPendingSignRequest',

  /** Get pending sign raw transaction request for approval */
  GET_PENDING_SIGN_RAW_TX_REQUEST: 'wallet:getPendingSignRawTxRequest',

  /** Approve pending sign message request */
  APPROVE_SIGN_MESSAGE: 'wallet:approveSignMessage',

  /** Reject pending sign message request */
  REJECT_SIGN_MESSAGE: 'wallet:rejectSignMessage',

  /** Get pending connection request for approval */
  GET_PENDING_CONNECTION: 'wallet:getPendingConnection',

  /** Approve pending connection request */
  APPROVE_CONNECTION: 'wallet:approveConnection',

  /** Reject pending connection request */
  REJECT_CONNECTION: 'wallet:rejectConnection',

  /** Revoke origin permissions */
  REVOKE_ORIGIN: 'wallet:revokeOrigin',

  /** Sign a transaction (internal popup-initiated transactions) */
  SIGN_TRANSACTION: 'wallet:signTransaction',

  /** Build and sign a transaction without broadcasting */
  BUILD_AND_SIGN_TRANSACTION: 'wallet:buildAndSignTransaction',

  /** Estimate transaction fee for a given recipient and amount */
  ESTIMATE_TRANSACTION_FEE: 'wallet:estimateTransactionFee',

  /** Estimate max sendable amount (for "send max" feature) */
  ESTIMATE_MAX_SEND: 'wallet:estimateMaxSend',

  /** Send a transaction (internal popup-initiated transactions - builds, signs, and broadcasts) */
  SEND_TRANSACTION: 'wallet:sendTransaction',

  /** Send transaction using UTXO store (build, lock, broadcast atomically) */
  SEND_TRANSACTION_V2: 'wallet:sendTransactionV2',

  /** Broadcast a raw signed transaction (internal popup-initiated transactions) */
  BROADCAST_TRANSACTION: 'wallet:broadcastTransaction',

  /** Approve pending sign raw transaction request */
  APPROVE_SIGN_RAW_TX: 'wallet:approveSignRawTx',

  /** Reject pending sign raw transaction request */
  REJECT_SIGN_RAW_TX: 'wallet:rejectSignRawTx',

  /** Get pending sign raw transaction request */
  GET_PENDING_RAW_TX_REQUEST: 'wallet:getPendingRawTxRequest',
} as const;

// Re-export PROVIDER_METHODS for other files
export { PROVIDER_METHODS };

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
  LOCKED: 'LOCKED',

  /** No vault exists, user needs to create wallet */
  NO_VAULT: 'NO_VAULT',

  /** Incorrect password provided */
  BAD_PASSWORD: 'BAD_PASSWORD',

  /** Invalid address format */
  BAD_ADDRESS: 'BAD_ADDRESS',

  /** Invalid mnemonic phrase provided */
  INVALID_MNEMONIC: 'INVALID_MNEMONIC',

  /** Invalid account index provided */
  INVALID_ACCOUNT_INDEX: 'INVALID_ACCOUNT_INDEX',

  /** No account selected */
  NO_ACCOUNT: 'NO_ACCOUNT',

  /** Cannot hide the last visible account */
  CANNOT_HIDE_LAST_ACCOUNT: 'CANNOT_HIDE_LAST_ACCOUNT',

  /** Unsupported RPC method requested */
  METHOD_NOT_SUPPORTED: 'METHOD_NOT_SUPPORTED',

  /** Unauthorized: internal methods can only be called from popup/extension pages */
  UNAUTHORIZED: 'UNAUTHORIZED',

  /** Requested resource not found (e.g., pending approval request) */
  NOT_FOUND: 'NOT_FOUND',

  /** Invalid parameters provided to method */
  INVALID_PARAMS: 'INVALID_PARAMS',
} as const;

/**
 * Chrome Storage Keys - Keys used for chrome.storage.local
 */
export const STORAGE_KEYS = {
  /** Encrypted mnemonic data (iv, ct, salt) */
  ENCRYPTED_VAULT: 'enc',

  /** Array of accounts with name, address, and derivation index */
  ACCOUNTS: 'accounts',

  /** Current active account index */
  CURRENT_ACCOUNT_INDEX: 'currentAccountIndex',

  /** Auto-lock timeout in minutes */
  AUTO_LOCK_MINUTES: 'autoLockMinutes',

  /** Onboarding state - tracks whether secret phrase backup is complete */
  ONBOARDING_STATE: 'onboardingState',

  /** Array of approved origins (websites that can access wallet) */
  APPROVED_ORIGINS: 'approvedOrigins',

  /** Cached balances per account address (persisted for offline access) */
  CACHED_BALANCES: 'cachedBalances',

  /** UTXO store per account - tracks note state (available, in_flight, spent) */
  UTXO_STORE: 'utxoStore',

  /** Wallet transactions per account - separate from UTXO lifecycle */
  WALLET_TX_STORE: 'walletTxStore',

  /** Per-account sync state (last synced block height) */
  ACCOUNT_SYNC_STATE: 'accountSyncState',

  /** Storage schema version for migrations */
  SCHEMA_VERSION: 'schemaVersion',

  /** Last transaction sync timestamp per account */
  LAST_TX_SYNC: 'lastTxSync',
} as const;

/** Current storage schema version - increment when making breaking changes */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Chrome Alarm Names - Named alarms for scheduled tasks
 */
export const ALARM_NAMES = {
  /** Auto-lock timeout alarm */
  AUTO_LOCK: 'autoLock',
} as const;

/**
 * Message Targets - Used for window.postMessage routing
 */
export const MESSAGE_TARGETS = {
  /** Target identifier for wallet bridge messages */
  WALLET_BRIDGE: 'IRIS',
} as const;

/**
 * Configuration - Default settings
 */
/** Default auto-lock timeout in minutes */
export const AUTOLOCK_MINUTES = 15;

/** Default RPC endpoint URL */
export const RPC_ENDPOINT = 'https://rpc.nockbox.org';

/**
 * Nockchain Currency Conversion
 */
/** Conversion rate: 1 NOCK = 65,536 nicks (2^16) */
export const NOCK_TO_NICKS = 65_536;

/** Default transaction fee in nicks (3,407,872 nicks = 52 NOCK)
 * Used only for UI defaults in send form and approval screens.
 * Actual fees are ALWAYS auto-calculated by WASM based on transaction size.
 * This is just a reasonable starting point for the fee input field.
 */
export const DEFAULT_TRANSACTION_FEE = 3_407_872;

/** Fee per word (8-byte unit) for transaction size calculation in nicks */
export const DEFAULT_FEE_PER_WORD = 1 << 15; // 32,768 nicks = 0.5 NOCK per word

/**
 * User Activity Methods - Methods that count as user activity for auto-lock timer
 * Only these methods reset the lastActivity timestamp. Passive/polling methods
 * (like GET_STATE, GET_ACCOUNTS, etc.) do NOT reset the timer.
 */
export const USER_ACTIVITY_METHODS = new Set([
  // Provider methods (user-initiated actions from dApps)
  PROVIDER_METHODS.CONNECT,
  PROVIDER_METHODS.SIGN_MESSAGE,
  PROVIDER_METHODS.SEND_TRANSACTION,
  PROVIDER_METHODS.SIGN_RAW_TX,

  // Internal methods (user actions in the UI)
  INTERNAL_METHODS.UNLOCK,
  INTERNAL_METHODS.SWITCH_ACCOUNT,
  INTERNAL_METHODS.CREATE_ACCOUNT,
  INTERNAL_METHODS.RENAME_ACCOUNT,
  INTERNAL_METHODS.UPDATE_ACCOUNT_STYLING,
  INTERNAL_METHODS.HIDE_ACCOUNT,
  INTERNAL_METHODS.SET_AUTO_LOCK,
  INTERNAL_METHODS.GET_MNEMONIC, // Viewing secret phrase is user activity
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
 * Account Icon Colors - Available colors for account customization
 */
export const ACCOUNT_COLORS = [
  '#2C9AEF', // blue
  '#EF2C2F', // red
  '#FFC413', // yellow (primary)
  '#96B839', // green
  '#3C2CEF', // purple
  '#EF2CB1', // pink/magenta
  '#2C6AEF', // darker blue
] as const;

/**
 * Preset Wallet Styles - Predetermined icon/color combinations for first 21 wallets
 * Ensures visual variety without repeating until all presets are used
 * After preset limit, random combinations are used
 */
export const PRESET_WALLET_STYLES = [
  { iconStyleId: 1, iconColor: '#FFC413' }, // Wallet 1: yellow, style 1
  { iconStyleId: 5, iconColor: '#2C9AEF' }, // Wallet 2: blue, style 5
  { iconStyleId: 9, iconColor: '#EF2C2F' }, // Wallet 3: red, style 9
  { iconStyleId: 3, iconColor: '#96B839' }, // Wallet 4: green, style 3
  { iconStyleId: 12, iconColor: '#3C2CEF' }, // Wallet 5: purple, style 12
  { iconStyleId: 7, iconColor: '#EF2CB1' }, // Wallet 6: pink, style 7
  { iconStyleId: 15, iconColor: '#2C6AEF' }, // Wallet 7: dark blue, style 15
  { iconStyleId: 2, iconColor: '#EF2C2F' }, // Wallet 8: red, style 2
  { iconStyleId: 6, iconColor: '#FFC413' }, // Wallet 9: yellow, style 6
  { iconStyleId: 10, iconColor: '#96B839' }, // Wallet 10: green, style 10
  { iconStyleId: 4, iconColor: '#2C9AEF' }, // Wallet 11: blue, style 4
  { iconStyleId: 13, iconColor: '#EF2CB1' }, // Wallet 12: pink, style 13
  { iconStyleId: 8, iconColor: '#3C2CEF' }, // Wallet 13: purple, style 8
  { iconStyleId: 14, iconColor: '#2C6AEF' }, // Wallet 14: dark blue, style 14
  { iconStyleId: 11, iconColor: '#EF2C2F' }, // Wallet 15: red, style 11
  { iconStyleId: 1, iconColor: '#96B839' }, // Wallet 16: green, style 1
  { iconStyleId: 5, iconColor: '#FFC413' }, // Wallet 17: yellow, style 5
  { iconStyleId: 9, iconColor: '#2C9AEF' }, // Wallet 18: blue, style 9
  { iconStyleId: 3, iconColor: '#3C2CEF' }, // Wallet 19: purple, style 3
  { iconStyleId: 12, iconColor: '#EF2CB1' }, // Wallet 20: pink, style 12
  { iconStyleId: 7, iconColor: '#2C6AEF' }, // Wallet 21: dark blue, style 7
] as const;

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
  /** Hash prefix for sign raw transaction approval requests */
  SIGN_RAW_TX_HASH_PREFIX: 'sign-raw-tx-approval-',
} as const;

/**
 * Blockchain Constants - Transaction confirmation and block time settings
 */
/** Average block time in milliseconds (~10 minutes) */
export const BLOCK_TIME_MS = 600_000;

/** Number of confirmations required for a transaction to be considered fully confirmed */
export const REQUIRED_CONFIRMATIONS = 6;

/** Number of confirmations after which we stop actively monitoring (save resources) */
export const MAX_MONITORED_CONFIRMATIONS = 10;
