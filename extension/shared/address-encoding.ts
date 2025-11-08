/**
 * Address encoding utilities for Nockchain V1
 * Converts public keys to base58-encoded PKH addresses
 */

import { base58 } from '@scure/base';
import { tip5Hash } from '../lib/nbx-crypto/nbx_crypto.js';

/**
 * Converts a public key to a Nockchain V1 PKH (Public Key Hash) address
 * An address is the base58-encoded TIP5 hash of the public key
 *
 * @param publicKey - The 97-byte public key from WASM
 * @returns A ~60-character base58-encoded PKH address
 */
export function publicKeyToPKH(publicKey: Uint8Array): string {
  if (publicKey.length !== 97) {
    throw new Error(`Invalid public key length: ${publicKey.length}, expected 97`);
  }

  // Hash the public key with TIP5
  const pkh = tip5Hash(publicKey);

  // Base58 encode the hash
  const address = base58.encode(pkh);

  return address;
}

/**
 * Converts digest bytes (40 bytes) to a base58-encoded digest string
 * Used for communicating with WASM API which uses string-based digests
 *
 * @param digestBytes - The 40-byte digest (TIP5 hash)
 * @returns Base58-encoded digest string
 */
export function digestBytesToString(digestBytes: Uint8Array): string {
  if (digestBytes.length !== 40) {
    throw new Error(`Invalid digest length: ${digestBytes.length}, expected 40`);
  }
  return base58.encode(digestBytes);
}

/**
 * Converts a base58-encoded digest string to bytes
 * Used for communicating with WASM API which uses string-based digests
 *
 * @param digestString - Base58-encoded digest string
 * @returns The 40-byte digest
 */
export function digestStringToBytes(digestString: string): Uint8Array {
  const bytes = base58.decode(digestString);
  if (bytes.length !== 40) {
    throw new Error(`Decoded digest has invalid length: ${bytes.length}, expected 40`);
  }
  return bytes;
}

/**
 * Converts a public key to a PKH digest string (for WASM API)
 * Hashes the public key and returns base58-encoded string
 *
 * @param publicKey - The 97-byte public key
 * @returns Base58-encoded PKH digest string
 */
export function publicKeyToPKHDigest(publicKey: Uint8Array): string {
  if (publicKey.length !== 97) {
    throw new Error(`Invalid public key length: ${publicKey.length}, expected 97`);
  }
  const pkh = tip5Hash(publicKey);
  return base58.encode(pkh);
}
