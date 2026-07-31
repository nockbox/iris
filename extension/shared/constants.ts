/**
 * Application Constants
 * Defines all method names, error codes, storage keys, and other constants
 * for wallet provider API and internal extension communication
 */

// Import provider methods from SDK
import { PROVIDER_METHODS } from '@nockbox/iris-sdk';
export { PROVIDER_METHODS };

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

  /** Create a child sub-account under a specific seed source */
  CREATE_CHILD_ACCOUNT: 'wallet:createChildAccount',

  /** Create/import mnemonic-based seed source */
  CREATE_MNEMONIC_SEED_SOURCE: 'wallet:createMnemonicSeedSource',

  /** Create external seed source (e.g. Ledger) */
  CREATE_EXTERNAL_SEED_SOURCE: 'wallet:createExternalSeedSource',

  /** Switch to a different account (by address) */
  SWITCH_ACCOUNT: 'wallet:switchAccount',

  /** Get flattened account list */
  GET_ACCOUNTS: 'wallet:getAccounts',

  /** Get all top-level seed/external account sources */
  GET_SEED_SOURCES: 'wallet:getSeedSources',

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

  /** Get balance from UTXO store (excludes in-flight notes) */
  GET_BALANCE_FROM_STORE: 'wallet:getBalanceFromStore',

  /** Get RPC connection status */
  GET_CONNECTION_STATUS: 'wallet:getConnectionStatus',

  /** Report RPC connection status from popup (where gRPC calls happen) */
  REPORT_RPC_STATUS: 'wallet:reportRpcStatus',

  /** Report user activity (e.g., popup opened) - resets auto-lock timer */
  REPORT_ACTIVITY: 'wallet:reportActivity',

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

  /** Estimate transaction fee for a given recipient and amount */
  ESTIMATE_TRANSACTION_FEE: 'wallet:estimateTransactionFee',

  /** Estimate max sendable amount (for "send max" feature) */
  ESTIMATE_MAX_SEND: 'wallet:estimateMaxSend',

  /** Send a transaction (internal popup-initiated transactions - builds, signs, and broadcasts) */
  SEND_TRANSACTION: 'wallet:sendTransaction',

  /** Send transaction using UTXO store (build, lock, broadcast atomically) */
  SEND_TRANSACTION_V2: 'wallet:sendTransactionV2',

  /** Estimate bridge transaction fee for a given destination and amount */
  ESTIMATE_BRIDGE_FEE: 'wallet:estimateBridgeFee',

  /** Estimate max bridgeable amount after reserving network fee */
  ESTIMATE_MAX_BRIDGE: 'wallet:estimateMaxBridge',

  /** Build, sign, and broadcast a bridge transaction (Nockchain → Base) */
  SEND_BRIDGE_TRANSACTION: 'wallet:sendBridgeTransaction',

  /** Approve pending sign raw transaction request */
  APPROVE_SIGN_RAW_TX: 'wallet:approveSignRawTx',

  /** Reject pending sign raw transaction request */
  REJECT_SIGN_RAW_TX: 'wallet:rejectSignRawTx',

  /** Get pending sign raw transaction request */
  GET_PENDING_RAW_TX_REQUEST: 'wallet:getPendingRawTxRequest',

  /** Sync UTXOs for all accounts (called from popup, runs in background) */
  SYNC_UTXOS: 'wallet:syncUtxos',

  /** Get wallet transactions for an account (from encrypted store) */
  GET_WALLET_TRANSACTIONS: 'wallet:getWalletTransactions',

  /** Record a v0 migration transaction after broadcast, before chain confirmation */
  RECORD_PENDING_V0_MIGRATION: 'wallet:recordPendingV0Migration',

  /** Get cached balances for all accounts (from encrypted store) */
  GET_CACHED_BALANCES: 'wallet:getCachedBalances',

  /** Update cached balances (to encrypted store) */
  SET_CACHED_BALANCES: 'wallet:setCachedBalances',

  /** Get balance summary for an account */
  GET_BALANCE_SUMMARY: 'wallet:getBalanceSummary',

  /** Initialize UTXOs for an account (first sync after creation) */
  INITIALIZE_ACCOUNT_UTXOS: 'wallet:initializeAccountUtxos',

  /** Force resync an account's UTXOs */
  FORCE_RESYNC_ACCOUNT: 'wallet:forceResyncAccount',

  /** Get wallet display mode (popup or side panel) */
  GET_DISPLAY_MODE: 'wallet:getDisplayMode',

  /** Set wallet display mode (popup or side panel) */
  SET_DISPLAY_MODE: 'wallet:setDisplayMode',

  /** Get the currently active pending approval (side panel) */
  GET_PENDING_APPROVAL: 'wallet:getPendingApproval',
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

  /** Master wallet for this seed is *deleted* (hidden)*/
  MASTER_WALLET_HIDDEN: 'MASTER_WALLET_HIDDEN',

  /** Unsupported RPC method requested */
  METHOD_NOT_SUPPORTED: 'METHOD_NOT_SUPPORTED',

  /** Unauthorized: internal methods can only be called from popup/extension pages */
  UNAUTHORIZED: 'UNAUTHORIZED',

  /** Requested resource not found (e.g., pending approval request) */
  NOT_FOUND: 'NOT_FOUND',

  /** Invalid parameters provided to method */
  INVALID_PARAMS: 'INVALID_PARAMS',

  /** Seed phrase is already present in the vault */
  DUPLICATE_SEED: 'DUPLICATE_SEED',

  /** Cannot perform operation on a hidden (deleted) account */
  ACCOUNT_HIDDEN: 'ACCOUNT_HIDDEN',
} as const;

/**
 * Chrome Storage Keys - Keys used for chrome.storage.local
 */
export const STORAGE_KEYS = {
  /** Encrypted mnemonic data (iv, ct, salt) */
  ENCRYPTED_VAULT: 'enc',

  /** Encrypted account data (notes, transactions, balances) */
  ENCRYPTED_ACCOUNT_DATA: 'encAccountData',

  /** Current active account index */
  CURRENT_ACCOUNT_INDEX: 'currentAccountIndex',

  /** Auto-lock timeout in minutes */
  AUTO_LOCK_MINUTES: 'autoLockMinutes',

  /** Whether balance is hidden (privacy mode) */
  BALANCE_HIDDEN: 'balanceHidden',

  /** UI display order for top-level seed groups */
  SEED_DISPLAY_ORDER: 'seedDisplayOrder',

  /** Onboarding state - tracks whether secret phrase backup is complete */
  ONBOARDING_STATE: 'onboardingState',

  /** Array of approved origins (websites that can access wallet) */
  APPROVED_ORIGINS: 'approvedOrigins',

  /**
   * @deprecated Cached balances per account address (persisted for offline access)
   */
  CACHED_BALANCES: 'cachedBalances',

  /**
   * @deprecated UTXO store per account - tracks note state (available, in_flight, spent)
   */
  UTXO_STORE: 'utxoStore',

  /**
   * @deprecated Wallet transactions per account - separate from UTXO lifecycle
   */
  WALLET_TX_STORE: 'walletTxStore',

  /** Per-account sync state (last synced block height) */
  ACCOUNT_SYNC_STATE: 'accountSyncState',

  /** Storage schema version for migrations */
  SCHEMA_VERSION: 'schemaVersion',

  /** Last user activity timestamp for auto-lock (survives SW restarts) */
  LAST_ACTIVITY: 'lastActivity',

  /** Whether the user manually locked the wallet (survives SW restarts) */
  MANUALLY_LOCKED: 'manuallyLocked',

  /** User RPC/network config (endpoint, network name, block explorer); falls back to defaults if unset */
  RPC_CONFIG: 'rpcConfig',

  /** Wallet UI display mode: 'popup' | 'sidepanel' */
  DISPLAY_MODE: 'displayMode',
} as const;

/**
 * Chrome Session Storage Keys - ephemeral cache for unlocked session data
 */
export const SESSION_STORAGE_KEYS = {
  /** Cached encryption key to restore unlock state after SW restarts */
  UNLOCK_CACHE: 'unlockCache',

  /** Pending dApp approval state (survives service worker restarts) */
  PENDING_APPROVALS: 'pendingApprovals',
} as const;

/** Current storage schema version - increment when making breaking changes */
export const CURRENT_SCHEMA_VERSION = 1;

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
/** Default auto-lock timeout in minutes. */
export const AUTOLOCK_MINUTES = 10;

/** Supported auto-lock choices. Zero preserves the explicit "Never" preference. */
export const AUTOLOCK_ALLOWED_MINUTES = [0, 1, 5, 10, 15, 30, 60, 240] as const;

/** Default RPC endpoint URL */
export const RPC_ENDPOINT = 'rpc.nockbox.org';

/** Default Chain ID */
export const CHAIN_ID = 'nockchain-1';

/**
 * Nockchain Currency Conversion
 */
/** Conversion rate: 1 NOCK = 65,536 nicks (2^16) */
export const NOCK_TO_NICKS = 65_536;

/** How many slip10 child indices (1..N) to scan on-chain when discovering funded sub-wallets. */
export const MAX_SUBWALLET_DISCOVERY_SCAN = 10;

/** Default transaction fee in nicks (3,407,872 nicks = 52 NOCK)
 * Used only for UI defaults in send form and approval screens.
 * Actual fees are ALWAYS auto-calculated by WASM based on transaction size.
 * This is just a reasonable starting point for the fee input field.
 */
export const DEFAULT_TRANSACTION_FEE = 3_407_872;

/**
 * User Activity Methods - Methods that count as user activity for auto-lock timer
 * Only these methods reset the lastActivity timestamp. Passive/polling methods
 * (like GET_STATE, GET_ACCOUNTS, etc.) do NOT reset the timer.
 */
export const USER_ACTIVITY_METHODS = new Set([
  // Internal methods (user actions in the UI)
  INTERNAL_METHODS.UNLOCK,
  INTERNAL_METHODS.SWITCH_ACCOUNT,
  INTERNAL_METHODS.CREATE_CHILD_ACCOUNT,
  INTERNAL_METHODS.CREATE_MNEMONIC_SEED_SOURCE,
  INTERNAL_METHODS.CREATE_EXTERNAL_SEED_SOURCE,
  INTERNAL_METHODS.RENAME_ACCOUNT,
  INTERNAL_METHODS.UPDATE_ACCOUNT_STYLING,
  INTERNAL_METHODS.HIDE_ACCOUNT,
  INTERNAL_METHODS.SET_AUTO_LOCK,
  INTERNAL_METHODS.GET_MNEMONIC, // Viewing secret phrase is user activity
  INTERNAL_METHODS.SEND_TRANSACTION_V2,
  INTERNAL_METHODS.SEND_BRIDGE_TRANSACTION,
  INTERNAL_METHODS.ESTIMATE_TRANSACTION_FEE,
  INTERNAL_METHODS.ESTIMATE_MAX_SEND,
  INTERNAL_METHODS.APPROVE_CONNECTION,
  INTERNAL_METHODS.APPROVE_TRANSACTION,
  INTERNAL_METHODS.APPROVE_SIGN_MESSAGE,
  INTERNAL_METHODS.APPROVE_SIGN_RAW_TX,
  INTERNAL_METHODS.REPORT_ACTIVITY,
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
  /** Hash prefix for sign raw transaction approval requests */
  SIGN_RAW_TX_HASH_PREFIX: 'sign-raw-tx-approval-',
} as const;

/** Wallet display mode options */
export type DisplayMode = 'popup' | 'sidepanel';

export const DISPLAY_MODES = {
  POPUP: 'popup',
  SIDE_PANEL: 'sidepanel',
} as const satisfies Record<string, DisplayMode>;

/** Default for new installs and users without a persisted display-mode preference. */
export const DEFAULT_DISPLAY_MODE: DisplayMode = DISPLAY_MODES.SIDE_PANEL;

/** Runtime message types (chrome.runtime.sendMessage) */
export const RUNTIME_MESSAGE_TYPES = {
  /** Side panel should navigate to a pending approval */
  APPROVAL_PENDING: 'APPROVAL_PENDING',

  /** Background verifies that the document which opened an approval is still active. */
  REQUESTER_PING: 'REQUESTER_PING',
} as const;

export type ApprovalType = 'connect' | 'transaction' | 'sign-message' | 'sign-raw-tx';
