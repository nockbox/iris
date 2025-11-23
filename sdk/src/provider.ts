/**
 * NockchainProvider - Main SDK class for interacting with Iris wallet
 */

import type { Transaction, NockchainEvent, EventListener, InjectedNockchain } from './types.js';
import { TransactionBuilder } from './transaction.js';
import {
  WalletNotInstalledError,
  UserRejectedError,
  RpcError,
  NoAccountError,
} from './errors.js';

/**
 * NockchainProvider class - Main interface for dApps to interact with Iris wallet
 *
 * @example
 * ```typescript
 * const nockchain = new NockchainProvider();
 *
 * // Connect wallet
 * const accounts = await nockchain.requestAccounts();
 *
 * // Build and send transaction
 * const tx = nockchain.transaction()
 *   .to('recipient_address')
 *   .amount(1_000_000)
 *   .build();
 *
 * const txId = await nockchain.sendTransaction(tx);
 * ```
 */
export class NockchainProvider {
  private injected: InjectedNockchain;
  private eventListeners: Map<NockchainEvent, Set<EventListener>>;
  private _accounts: string[] = [];
  private _chainId: string | null = null;
  private _messageHandler?: (event: MessageEvent) => void;

  /**
   * Create a new NockchainProvider instance
   * @throws {WalletNotInstalledError} If the Iris extension is not installed
   */
  constructor() {
    if (typeof window === 'undefined') {
      throw new Error('NockchainProvider can only be used in a browser environment');
    }

    const injected = window.nockchain;

    // Verify Iris extension is installed and authentic
    // The isIris brand prevents other extensions from hijacking window.nockchain
    if (!injected || injected.isIris !== true) {
      throw new WalletNotInstalledError();
    }

    this.injected = injected;
    this.eventListeners = new Map();

    // Initialize event listeners for wallet events
    this.setupEventListeners();
  }

  /**
   * Request connection to user accounts
   * This will prompt the user to approve the connection
   * @returns Promise resolving to an array of account addresses
   * @throws {UserRejectedError} If the user rejects the request
   * @throws {RpcError} If the RPC call fails
   */
  async requestAccounts(): Promise<string[]> {
    const accounts = await this.request<string[]>({
      method: 'nock_requestAccounts',
    });

    this._accounts = accounts ?? [];
    return this.accounts;
  }

  /**
   * Get the currently connected accounts (if any)
   * @returns Array of connected account addresses
   */
  get accounts(): string[] {
    return [...this._accounts];
  }

  /**
   * Get the current chain ID
   * @returns The current chain ID or null if not connected
   */
  get chainId(): string | null {
    return this._chainId;
  }

  /**
   * Check if the wallet is connected
   * @returns true if at least one account is connected
   */
  get isConnected(): boolean {
    return this._accounts.length > 0;
  }

  /**
   * Send a transaction
   * @param transaction - The transaction object to send
   * @returns Promise resolving to the transaction ID
   * @throws {NoAccountError} If no account is connected
   * @throws {UserRejectedError} If the user rejects the transaction
   * @throws {RpcError} If the RPC call fails
   */
  async sendTransaction(transaction: Transaction): Promise<string> {
    if (!this.isConnected) {
      throw new NoAccountError();
    }

    return this.request<string>({
      method: 'nock_sendTransaction',
      params: [transaction],
    });
  }

  /**
   * Sign an arbitrary message with the current account
   * @param message - The message to sign
   * @returns Promise resolving to the signature
   * @throws {NoAccountError} If no account is connected
   * @throws {UserRejectedError} If the user rejects the signing request
   * @throws {RpcError} If the RPC call fails
   */
  async signMessage(message: string): Promise<string> {
    if (!this.isConnected) {
      throw new NoAccountError();
    }

    return this.request<string>({
      method: 'nock_signMessage',
      params: [message],
    });
  }

  /**
   * Sign a raw transaction
   * @param params - The transaction parameters (toJam, notes, spendConditions)
   * @returns Promise resolving to the signed raw transaction jam
   * @throws {NoAccountError} If no account is connected
   * @throws {UserRejectedError} If the user rejects the signing request
   * @throws {RpcError} If the RPC call fails
   */
  async signRawTx(params: {
    toJam: any;
    notes: any[];
    spendConditions: any[];
  }): Promise<string> {
    if (!this.isConnected) {
      throw new NoAccountError();
    }

    return this.request<string>({
      method: 'nock_signRawTx',
      params: [params],
    });
  }

  /**
   * Get wallet information
   * @returns Promise resolving to the wallet info (PKH and gRPC endpoint)
   * @throws {NoAccountError} If no account is connected
   * @throws {RpcError} If the RPC call fails
   */
  async getWalletInfo(): Promise<{ pkh: string; grpcEndpoint: string }> {
    if (!this.isConnected) {
      throw new NoAccountError();
    }

    return this.request<{ pkh: string; grpcEndpoint: string }>({
      method: 'nock_getWalletInfo',
    });
  }

  /**
   * Create a new transaction builder
   * @returns A new TransactionBuilder instance
   *
   * @example
   * ```typescript
   * const tx = provider.transaction()
   *   .to('recipient_address')
   *   .amount(1_000_000)
   *   .fee(50_000)
   *   .build();
   * ```
   */
  transaction(): TransactionBuilder {
    return new TransactionBuilder();
  }

  /**
   * Add an event listener for wallet events
   * @param event - The event to listen for
   * @param listener - The callback function to invoke when the event occurs
   *
   * @example
   * ```typescript
   * provider.on('accountsChanged', (accounts) => {
   *   console.log('Accounts changed:', accounts);
   * });
   * ```
   */
  on<T = unknown>(event: NockchainEvent, listener: EventListener<T>): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener as EventListener);
  }

  /**
   * Remove an event listener
   * @param event - The event to stop listening for
   * @param listener - The callback function to remove
   */
  off<T = unknown>(event: NockchainEvent, listener: EventListener<T>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener as EventListener);
    }
  }

  /**
   * Remove all event listeners for a specific event or all events
   * @param event - Optional event to remove listeners for (removes all if not specified)
   */
  removeAllListeners(event?: NockchainEvent): void {
    if (event) {
      this.eventListeners.delete(event);
    } else {
      this.eventListeners.clear();
    }
  }

  /**
   * Make a raw RPC request to the wallet extension (EIP-1193 compatible)
   * @param args - The RPC request arguments
   * @returns Promise resolving to the result
   * @throws {UserRejectedError} If the user rejects the request
   * @throws {RpcError} If the RPC call fails
   */
  public async request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T> {
    try {
      const result = await this.injected.request<T>(args);
      return result;
    } catch (error) {
      // Handle RPC errors and map known error codes
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const { code, message, data } = error as { code: number; message: string; data?: unknown };
        const rpcError = new RpcError(code, message, data);

        // Map EIP-1193 error codes to typed errors
        if (this.isUserRejected(rpcError)) {
          throw new UserRejectedError(message);
        }

        throw rpcError;
      }
      // Re-throw other errors as-is
      throw error;
    }
  }

  /**
   * Check if an error represents user rejection
   * Uses EIP-1193 standard error code 4001
   */
  private isUserRejected(error: RpcError | unknown): boolean {
    // EIP-1193 standard: 4001 = User Rejected Request
    const USER_REJECTED_CODES = new Set([4001]);

    if (error instanceof RpcError) {
      return USER_REJECTED_CODES.has(error.code);
    }

    // Fallback: check message for common rejection phrases
    if (error instanceof Error) {
      return /reject|denied|cancel/i.test(error.message);
    }

    return false;
  }

  /**
   * Set up event listeners for wallet events
   * This listens for events from the extension and forwards them to registered listeners
   */
  private setupEventListeners(): void {
    if (typeof window === 'undefined') return;

    this._messageHandler = (event: MessageEvent) => {
      // Only accept messages from the same window
      if (event.source !== window) return;

      const payload = event.data;

      // SECURITY: Verify the message is from Iris extension
      // This prevents malicious scripts from forging wallet events
      if (!payload || payload.__iris !== true) return;

      // Check if this is a valid wallet event
      if (typeof payload.type !== 'string' || !payload.type.startsWith('nockchain_')) return;

      const eventType = payload.type.replace('nockchain_', '') as NockchainEvent;
      const eventData = payload.data;

      // Update internal state based on event type
      if (eventType === 'accountsChanged' && Array.isArray(eventData)) {
        this._accounts = eventData;
      } else if (eventType === 'chainChanged' && typeof eventData === 'string') {
        this._chainId = eventData;
      } else if (eventType === 'disconnect') {
        // Clear state on disconnect
        this._accounts = [];
        this._chainId = null;
      }

      // Emit to registered listeners
      this.emit(eventType, eventData);
    };

    window.addEventListener('message', this._messageHandler);
  }

  /**
   * Clean up event listeners and resources
   * Call this when the provider is no longer needed (e.g., on component unmount)
   */
  public dispose(): void {
    if (this._messageHandler && typeof window !== 'undefined') {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = undefined;
    }
    this.removeAllListeners();
  }

  /**
   * Emit an event to all registered listeners
   * @param event - The event to emit
   * @param data - The data to pass to listeners
   */
  private emit<T = unknown>(event: NockchainEvent, data: T): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Check if the Iris extension is installed and authentic
   * @returns true if the extension is installed
   */
  static isInstalled(): boolean {
    return typeof window !== 'undefined' && !!window.nockchain?.isIris;
  }
}
