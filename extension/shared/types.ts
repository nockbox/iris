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
}

/**
 * Cached transaction for a specific account
 * Stored in chrome.storage for offline viewing
 */
export interface CachedTransaction {
  /** Transaction ID (hash) */
  txid: string;
  /** Transaction type relative to this account */
  type: 'sent' | 'received';
  /** Amount in NOCK */
  amount: number;
  /** Transaction fee in NOCK */
  fee: number;
  /** Counterparty address (recipient if sent, sender if received) */
  address: string;
  /** Transaction timestamp (milliseconds since epoch) */
  timestamp: number;
  /** Transaction status */
  status: 'confirmed' | 'pending' | 'failed';
  /** USD price at the time of transaction */
  priceUsd?: number;
}

/**
 * Transaction cache structure per account
 * Key is the account address
 */
export interface TransactionCache {
  [accountAddress: string]: CachedTransaction[];
}

/**
 * Last sync timestamp per account
 * Key is the account address, value is timestamp in milliseconds
 */
export interface LastSyncTimestamps {
  [accountAddress: string]: number;
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
}

/**
 * Pending raw transaction signing request from a dApp
 */
export interface SignRawTxRequest {
  /** Unique request ID */
  id: string;
  /** Origin of the requesting site */
  origin: string;
  /** Raw transaction jam as hex string */
  rawTx: string;
  /** Input notes (protobuf) */
  notes: any[];
  /** Spend conditions (protobuf) */
  spendConditions: any[];
  /** Request timestamp */
  timestamp: number;
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
