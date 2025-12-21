/**
 * Shared TypeScript types and interfaces
 */

import { PROVIDER_METHODS, INTERNAL_METHODS, RPC_METHODS, ERROR_CODES } from './constants';

/**
 * Account information for multi-account wallet
 * Each account is derived from the same mnemonic using BIP-44 derivation paths
 */
export interface Account {
  /** User-defined account name (editable) */
  name: string;
  /** Nockchain V1 PKH address (40 bytes base58-encoded, ~54-55 chars) */
  address: string;
  /** BIP-44 derivation index (0, 1, 2, ...) */
  index: number;
  /** Icon style ID (1-15, defaults to index % 3 + 1 for variety) */
  iconStyleId?: number;
  /** Icon color (hex string, defaults to #FFC413) */
  iconColor?: string;
  /** Whether this account is hidden from the UI */
  hidden?: boolean;
  /** Timestamp when the account was created (milliseconds since epoch) */
  createdAt?: number;
  /** Derivation path: 'master' (master key) or 'derived' (child key at index) */
  derivation?: 'master' | 'slip10';
}

/**
 * Type for all valid RPC method names
 */
export type RPCMethod = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

/**
 * Type for provider method names only
 */
export type ProviderMethod = (typeof PROVIDER_METHODS)[keyof typeof PROVIDER_METHODS];

/**
 * Type for internal method names only
 */
export type InternalMethod = (typeof INTERNAL_METHODS)[keyof typeof INTERNAL_METHODS];

/**
 * Type for all valid error codes
 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Transaction information
 * Represents a blockchain transaction (sent or received)
 */
export interface Transaction {
  /** Unique transaction ID */
  id: string;
  /** Transaction type */
  type: 'sent' | 'received';
  /** Amount in NOCK */
  amount: number;
  /** Counterparty address (sender for received, recipient for sent) */
  address: string;
  /** Transaction timestamp */
  timestamp: Date;
  /** Transaction status */
  status: 'confirmed' | 'pending' | 'failed';
}

/**
 * Transaction details for confirmation screen
 * Used to display transaction details immediately after sending
 */
export interface TransactionDetails {
  /** Transaction ID */
  txid: string;
  /** Amount in NOCK */
  amount: number;
  /** Transaction fee in NOCK */
  fee: number;
  /** Recipient address */
  to?: string;
  /** Sender address */
  from?: string;
  /** Protobuf transaction object for debugging/export (dev feature) */
  protobufTx?: any;
  /** Whether this is a sweep transaction (all UTXOs sent to recipient) */
  sendMax?: boolean;
}

/**
 * Structured balance information for an account
 * Separates confirmed (on-chain) balance from pending transaction effects
 */
export interface AccountBalance {
  /** Balance from confirmed UTXOs on-chain */
  confirmed: number;
  /** Sum of (amount + fee) for pending outbound transactions */
  pendingOut: number;
  /** Sum of amounts for pending inbound transactions */
  pendingIn: number;
  /** Spendable balance: confirmed - pendingOut */
  available: number;
}

/**
 * Pending connection request from a dApp
 */
export interface ConnectRequest {
  /** Unique request ID */
  id: string;
  /** Origin of the requesting site (e.g., "https://app.example.com") */
  origin: string;
  /** Request timestamp */
  timestamp: number;

  /** Optional signing context */
  signWith?: 'v1' | 'v0';

  /** v0 derivation label when signWith='v0' */
  v0Derivation?: 'master' | 'child0' | 'hard0';
}

/**
 * Pending sign message request from a dApp
 */
export interface SignRequest {
  /** Unique request ID */
  id: string;
  /** Origin of the requesting site (e.g., "https://app.example.com") */
  origin: string;
  /** Message to be signed */
  message: string;
  /** Request timestamp */
  timestamp: number;

  /** Optional signing context */
  signWith?: 'v1' | 'v0';

  /** v0 derivation label when signWith='v0' */
  v0Derivation?: 'master' | 'child0' | 'hard0';
}

/**
 * Pending transaction approval request from a dApp
 */
export interface TransactionRequest {
  /** Unique request ID */
  id: string;
  /** Origin of the requesting site (e.g., "https://app.example.com") */
  origin: string;
  /** Recipient address */
  to: string;
  /** Amount in nicks */
  amount: number;
  /** Transaction fee in nicks */
  fee: number;
  /** Request timestamp */
  timestamp: number;

  /** Optional signing context */
  signWith?: 'v1' | 'v0';

  /** v0 derivation label when signWith='v0' */
  v0Derivation?: 'master' | 'child0' | 'hard0';
}

/**
 * Pending raw transaction signing request from a dApp
 */
export interface SignRawTxRequest {
  /** Unique request ID */
  id: string;
  /** Origin of the requesting site */
  origin: string;
  /** Raw transaction protobuf */
  rawTx: any;
  /** Input notes (protobuf) */
  notes: any[];
  /** Spend conditions (protobuf) */
  spendConditions: any[];
  /** Output notes (protobuf). Ignored from dApp side */
  outputs?: any[];
  /** Request timestamp */
  timestamp: number;

  /** Optional signing context */
  signWith?: 'v1' | 'v0';

  /** v0 derivation label when signWith='v0' */
  v0Derivation?: 'master' | 'child0' | 'hard0';
}

/**
 * Nockchain note (UTXO) structure
 * Represents an unspent transaction output on the blockchain
 */
export interface Note {
  /** Note version (0 for legacy, 1 for v1) */
  version: number;
  /** Origin page (block height where note was created) */
  originPage: bigint;
  /** Minimum timelock (optional, for coinbase/timelocked notes) */
  timelockMin?: bigint;
  /** Maximum timelock (optional, for coinbase/timelocked notes) */
  timelockMax?: bigint;
  /** First 40 bytes of note name (80-byte identifier) */
  nameFirst: Uint8Array;
  /** Last 40 bytes of note name (80-byte identifier) */
  nameLast: Uint8Array;
  /** First name as base58 string (optional, from WASM gRPC client) */
  nameFirstBase58?: string;
  /** Last name as base58 string (optional, from WASM gRPC client) */
  nameLastBase58?: string;
  /** Note data hash as base58 string (optional, from WASM gRPC client) */
  noteDataHashBase58?: string;
  /** Public keys for lock (legacy format) */
  lockPubkeys: Uint8Array[];
  /** Number of keys required to unlock (legacy format) */
  lockKeysRequired: bigint;
  /** Source transaction hash */
  sourceHash: Uint8Array;
  /** Whether this note is from a coinbase (mining reward) transaction */
  sourceIsCoinbase: boolean;
  /** Amount in nicks (1 NOCK = 65,536 nicks) */
  assets: number;
  /** Raw protobuf note object from RPC (for Note.fromProtobuf) */
  protoNote?: any;
}

// ============================================================================
// UTXO Store Types - For tracking note lifecycle and enabling successive sends
// ============================================================================

/**
 * Note state in the UTXO store
 * - available: Can be used in new transactions
 * - in_flight: Reserved by a pending transaction (locked until confirmed or expired)
 * - spent: Transaction confirmed, note is consumed
 */
export type NoteState = 'available' | 'in_flight' | 'spent';

/**
 * Stored note (UTXO) with state tracking
 * This is the core type for the local UTXO store
 */
export interface StoredNote {
  /** Unique identifier: nameFirst:nameLast in base58 */
  noteId: string;

  /** Account that owns this note */
  accountAddress: string;

  // Chain identity
  /** Source transaction hash (base58) that created this note */
  sourceHash: string;
  /** Block height where this note was created */
  originPage: number;

  // Value
  /** Amount in nicks (1 NOCK = 65,536 nicks) */
  assets: number;

  // For WASM transaction building
  /** First 40 bytes of note name as base58 */
  nameFirst: string;
  /** Last 40 bytes of note name as base58 */
  nameLast: string;
  /** Note data hash as base58 (for WASM) */
  noteDataHashBase58: string;
  /** Raw protobuf note for WasmNote.fromProtobuf() */
  protoNote: any;

  // State tracking
  /** Current state of this note */
  state: NoteState;
  /** If in_flight, which wallet transaction is using this note */
  pendingTxId?: string;
  /** Was this note change from one of our own transactions? */
  isChange?: boolean;

  // Metadata
  /** Timestamp when this note was first discovered (ms since epoch) */
  discoveredAt: number;
}

/**
 * UTXO store structure - per account
 */
export interface UTXOStore {
  [accountAddress: string]: {
    notes: StoredNote[];
    /** Version for optimistic locking / conflict detection */
    version: number;
  };
}

// ============================================================================
// Wallet Transaction Types - Separate from UTXO lifecycle
// ============================================================================

/**
 * Wallet transaction status
 * - created: Transaction object created but not yet broadcasted
 * - broadcast_pending: Attempting to broadcast
 * - broadcasted_unconfirmed: In mempool, waiting for confirmation
 * - confirmed: Included in a block
 * - failed: Broadcast or confirmation failed
 * - expired: Timed out waiting for confirmation
 */
export type WalletTxStatus =
  | 'created'
  | 'broadcast_pending'
  | 'broadcasted_unconfirmed'
  | 'confirmed'
  | 'failed'
  | 'expired';

/**
 * Wallet transaction record
 * Links to StoredNotes via noteIds
 */
export interface WalletTransaction {
  /** Internal unique ID (UUID) */
  id: string;

  /** On-chain transaction hash (known after broadcast) */
  txHash?: string;

  /** Account that initiated/received this transaction */
  accountAddress: string;

  /** Transaction direction relative to this account */
  direction: 'outgoing' | 'incoming' | 'self';

  // Timestamps
  /** When the transaction was created (ms since epoch) */
  createdAt: number;
  /** When the transaction was last updated (ms since epoch) */
  updatedAt: number;

  /** USD price per NOCK at the time of transaction */
  priceUsdAtTime?: number;

  /** Current status */
  status: WalletTxStatus;

  // For outgoing transactions
  /** Note IDs used as inputs (spent) */
  inputNoteIds?: string[];
  /** Expected change note IDs (predicted before confirmation) */
  expectedChangeNoteIds?: string[];
  /** Expected change amount in nicks (sum of inputs - amount - fee) */
  expectedChange?: number;
  /** Recipient address */
  recipient?: string;
  /** Amount sent in nicks */
  amount?: number;
  /** Fee paid in nicks */
  fee?: number;

  // For incoming transactions
  /** Note IDs received */
  receivedNoteIds?: string[];
  /** Sender address (if known) */
  sender?: string;

  // Confirmation tracking
  /** Block height when confirmed */
  confirmedAtBlock?: number;
  /** Number of confirmations */
  confirmations?: number;
}

/**
 * Wallet transaction store - per account
 */
export interface WalletTxStore {
  [accountAddress: string]: WalletTransaction[];
}

/**
 * Per-account sync state for incremental UTXO syncing
 */
export interface AccountSyncState {
  accountAddress: string;
  /** Last block height that was fully synced (inclusive) */
  lastSyncedHeight: number;
  /** Timestamp of last successful sync */
  lastSyncedAt: number;
}

/**
 * Sync state store - per account
 */
export interface SyncStateStore {
  [accountAddress: string]: AccountSyncState;
}

/**
 * Expected change output - tracked before broadcast to identify change vs incoming
 */
export interface ExpectedChange {
  /** Wallet transaction ID that will produce this change */
  walletTxId: string;
  /** Predicted note ID (if deterministic) */
  expectedNoteId?: string;
  /** Expected transaction hash (if known before broadcast) */
  expectedTxHash?: string;
  /** Account address */
  accountAddress: string;
}

// ============================================================================
// UTXO Diff Types - For pure diff computation in utxo-sync
// ============================================================================

/**
 * Fetched UTXO from chain (before being stored)
 */
export interface FetchedUTXO {
  noteId: string;
  sourceHash: string;
  originPage: number;
  assets: number;
  nameFirst: string;
  nameLast: string;
  noteDataHashBase58: string;
  protoNote: any;
}

/**
 * Result of diffing local store against chain state
 */
export interface UTXODiff {
  /** UTXOs on chain that are not in our local store (new) */
  newUTXOs: FetchedUTXO[];
  /** UTXOs that exist both locally and on chain (unchanged) */
  stillUnspent: StoredNote[];
  /** UTXOs in our local store that are no longer on chain (spent) */
  nowSpent: StoredNote[];
  /** Map of noteId -> walletTxId for notes that are change from our own txs */
  isChangeMap: Map<string, string>;
}

/**
 * Last sync timestamps per account address
 */
export interface LastSyncTimestamps {
  [accountAddress: string]: number;
}
