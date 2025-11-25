/**
 * Address encoding utilities for Nockchain V1
 * Converts public keys to base58-encoded PKH addresses
 */

import { base58 } from '@scure/base';
import { hashPublicKey } from '@nockbox/iris-wasm/iris_wasm.js';

/**
 * Converts a public key to a Nockchain V1 PKH (Public Key Hash) address
 * Uses proper Noun representation before hashing (matches CLI wallet)
 *
 * @param publicKey - The 97-byte public key from WASM
 * @returns A ~60-character base58-encoded PKH address
 */
export function publicKeyToPKH(publicKey: Uint8Array): string {
  if (publicKey.length !== 97) {
    throw new Error(`Invalid public key length: ${publicKey.length}, expected 97`);
  }

  // Use proper Noun representation before hashing
  const address = hashPublicKey(publicKey);

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
 * Uses proper Noun representation before hashing (matches CLI wallet)
 *
 * @param publicKey - The 97-byte public key
 * @returns Base58-encoded PKH digest string
 */
export function publicKeyToPKHDigest(publicKey: Uint8Array): string {
  if (publicKey.length !== 97) {
    throw new Error(`Invalid public key length: ${publicKey.length}, expected 97`);
  }
  // Use proper Noun representation before hashing
  return hashPublicKey(publicKey);
}
