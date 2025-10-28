/**
 * Transaction builder with fluent API for constructing Nockchain transactions
 */

import type { Transaction } from './types.js';
import { InvalidAddressError, InvalidTransactionError } from './errors.js';

/**
 * Conversion rate: 1 NOCK = 65,536 nicks (2^16)
 */
export const NOCK_TO_NICKS = 65_536;

/**
 * Default transaction fee in nicks (32,768 nicks = 0.5 NOCK)
 */
export const DEFAULT_FEE = 32_768;

/**
 * Minimum amount in nicks (must be positive)
 */
export const MIN_AMOUNT = 1;

/**
 * TransactionBuilder class implementing the builder pattern for type-safe transaction construction
 *
 * @example
 * ```typescript
 * const tx = new TransactionBuilder()
 *   .to('nock1recipient_address')
 *   .amount(1_000_000)
 *   .fee(50_000)
 *   .build();
 * ```
 */
export class TransactionBuilder {
  private _to?: string;
  private _amount?: number;
  private _fee?: number;

  /**
   * Set the recipient address for the transaction
   * @param address - Base58-encoded Nockchain address (public key hash / PKH)
   * @returns A new TransactionBuilder instance with the address set
   * @throws {InvalidAddressError} If the address format is invalid
   */
  to(address: string): TransactionBuilder {
    if (!this.isValidAddress(address)) {
      throw new InvalidAddressError(address);
    }

    const builder = new TransactionBuilder();
    builder._to = address;
    builder._amount = this._amount;
    builder._fee = this._fee;
    return builder;
  }

  /**
   * Set the amount to send in nicks (1 NOCK = 65,536 nicks)
   * @param nicks - Amount in nicks (must be a positive integer)
   * @returns A new TransactionBuilder instance with the amount set
   * @throws {InvalidTransactionError} If the amount is invalid
   */
  amount(nicks: number): TransactionBuilder {
    if (!Number.isInteger(nicks)) {
      throw new InvalidTransactionError('Amount must be an integer');
    }
    if (nicks < MIN_AMOUNT) {
      throw new InvalidTransactionError(`Amount must be at least ${MIN_AMOUNT} nick`);
    }
    // Note: MIN_AMOUNT = 1, so the above check already covers negative amounts

    const builder = new TransactionBuilder();
    builder._to = this._to;
    builder._amount = nicks;
    builder._fee = this._fee;
    return builder;
  }

  /**
   * Set the transaction fee in nicks (optional, defaults to 32,768 nicks)
   * @param nicks - Fee amount in nicks (must be a positive integer)
   * @returns A new TransactionBuilder instance with the fee set
   * @throws {InvalidTransactionError} If the fee is invalid
   */
  fee(nicks: number): TransactionBuilder {
    if (!Number.isInteger(nicks)) {
      throw new InvalidTransactionError('Fee must be an integer');
    }
    if (nicks < 0) {
      throw new InvalidTransactionError('Fee must be non-negative');
    }

    const builder = new TransactionBuilder();
    builder._to = this._to;
    builder._amount = this._amount;
    builder._fee = nicks;
    return builder;
  }

  /**
   * Build and validate the transaction
   * @returns The constructed Transaction object
   * @throws {InvalidTransactionError} If required fields are missing
   */
  build(): Transaction {
    if (!this._to) {
      throw new InvalidTransactionError('Missing required field: to (recipient address)');
    }
    if (this._amount === undefined || this._amount === null) {
      throw new InvalidTransactionError('Missing required field: amount');
    }

    return {
      to: this._to,
      amount: this._amount,
      fee: this._fee ?? DEFAULT_FEE,
    };
  }

  /**
   * Validate a Nockchain address format
   * Currently performs basic base58 validation
   *
   * NOTE: This validation is intentionally permissive (20-100 chars) because:
   * - The final Nockchain address format is not yet finalized
   * - Address prefixes (e.g., "nock1") are not yet implemented
   * - This will be tightened once the address format is stable
   *
   * @param address - The address to validate
   * @returns true if valid, false otherwise
   */
  private isValidAddress(address: string): boolean {
    // Basic validation: must be a non-empty string
    if (!address || typeof address !== 'string') {
      return false;
    }

    // Must have reasonable length (base58 addresses are typically 32-44 chars)
    // Kept loose (20-100) until final format is confirmed
    if (address.length < 20 || address.length > 100) {
      return false;
    }

    // Base58 alphabet (Bitcoin-style, excluding 0, O, I, l)
    const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
    if (!base58Regex.test(address)) {
      return false;
    }

    // Future: When Nockchain implements address prefixes (e.g., "nock1"),
    // add prefix validation here

    return true;
  }

  /**
   * Create a transaction builder from an existing transaction object
   * Useful for modifying existing transactions
   * @param tx - The transaction to create a builder from
   * @returns A new TransactionBuilder instance with values from the transaction
   * @throws {InvalidAddressError} If the transaction address is invalid
   * @throws {InvalidTransactionError} If the transaction amount or fee is invalid
   */
  static fromTransaction(tx: Transaction): TransactionBuilder {
    // Use setters to ensure validation is applied
    let builder = new TransactionBuilder().to(tx.to).amount(tx.amount);

    if (typeof tx.fee === 'number') {
      builder = builder.fee(tx.fee);
    }

    return builder;
  }
}
