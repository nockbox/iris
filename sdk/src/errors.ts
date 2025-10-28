/**
 * Custom error classes for Fort Nock SDK
 */

/**
 * Thrown when the Fort Nock wallet extension is not installed
 */
export class WalletNotInstalledError extends Error {
  constructor() {
    super('Fort Nock wallet extension not installed. Please install it from the Chrome Web Store.');
    this.name = 'WalletNotInstalledError';
    Object.setPrototypeOf(this, WalletNotInstalledError.prototype);
  }
}

/**
 * Thrown when the user rejects a transaction or request
 */
export class UserRejectedError extends Error {
  constructor(message = 'User rejected the request') {
    super(message);
    this.name = 'UserRejectedError';
    Object.setPrototypeOf(this, UserRejectedError.prototype);
  }
}

/**
 * Thrown when an invalid Nockchain address is provided
 */
export class InvalidAddressError extends Error {
  constructor(address: string) {
    super(`Invalid Nockchain address: ${address}`);
    this.name = 'InvalidAddressError';
    Object.setPrototypeOf(this, InvalidAddressError.prototype);
  }
}

/**
 * Thrown when transaction building fails due to missing or invalid fields
 */
export class InvalidTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionError';
    Object.setPrototypeOf(this, InvalidTransactionError.prototype);
  }
}

/**
 * Thrown when a method is called that requires an account, but no account is connected
 */
export class NoAccountError extends Error {
  constructor() {
    super('No account connected. Call requestAccounts() first.');
    this.name = 'NoAccountError';
    Object.setPrototypeOf(this, NoAccountError.prototype);
  }
}

/**
 * Thrown when the RPC request to the extension fails
 */
export class RpcError extends Error {
  public code: number;
  public data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}
