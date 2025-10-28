/**
 * Fort Nock SDK - TypeScript SDK for interacting with Fort Nock wallet extension
 *
 * @packageDocumentation
 */

// Export main provider class
export { NockchainProvider } from './provider.js';

// Export transaction builder
export { TransactionBuilder, DEFAULT_FEE, MIN_AMOUNT, NOCK_TO_NICKS } from './transaction.js';

// Export types
export type {
  Transaction,
  RpcRequest,
  RpcResponse,
  NockchainEvent,
  EventListener,
  InjectedNockchain,
  ChainInfo,
  AccountInfo,
} from './types.js';

// Export errors
export {
  WalletNotInstalledError,
  UserRejectedError,
  InvalidAddressError,
  InvalidTransactionError,
  NoAccountError,
  RpcError,
} from './errors.js';
