/**
 * TypeScript type definitions for Fort Nock SDK
 */

/**
 * Transaction object representing a Nockchain transaction
 */
export interface Transaction {
  /** Recipient address (base58-encoded public key hash / PKH) */
  to: string;
  /** Amount to send in nicks (1 NOCK = 65,536 nicks) */
  amount: number;
  /** Transaction fee in nicks (optional, defaults to 32,768 = 0.5 NOCK) */
  fee?: number;
}

/**
 * RPC request object for communicating with the extension
 */
export interface RpcRequest {
  /** The RPC method to call */
  method: string;
  /** Optional parameters for the method */
  params?: unknown[];
}

/**
 * RPC response object from the extension
 */
export interface RpcResponse<T = unknown> {
  /** The result of the RPC call */
  result?: T;
  /** Error information if the call failed */
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Event types that the provider can emit
 */
export type NockchainEvent = 'accountsChanged' | 'chainChanged' | 'connect' | 'disconnect';

/**
 * Event listener callback function
 */
export type EventListener<T = unknown> = (data: T) => void;

/**
 * Interface for the injected window.nockchain object
 */
export interface InjectedNockchain {
  /**
   * Make an RPC request to the wallet extension
   * @param request - The RPC request object
   * @returns Promise resolving to the result
   */
  request<T = unknown>(request: RpcRequest): Promise<T>;

  /**
   * Check if the provider is Fort Nock
   */
  isFortNock?: boolean;
}

/**
 * Extended Window interface with nockchain property
 */
declare global {
  interface Window {
    nockchain?: InjectedNockchain;
  }
}

/**
 * Chain information
 */
export interface ChainInfo {
  /** Chain ID (e.g., 'mainnet', 'testnet') */
  chainId: string;
  /** Network name */
  name: string;
}

/**
 * Account information
 */
export interface AccountInfo {
  /** Account address */
  address: string;
  /** Account balance in nicks (optional, may not be available) */
  balance?: number;
}
