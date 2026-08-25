/**
 * Wallet cryptographic utilities
 * Integrates Nockchain WASM bindings
 */

import {
  generateMnemonic as generateMnemonicScure,
  validateMnemonic as validateMnemonicScure,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import wasm from './sdk-wasm.js';
import { publicKeyToPKH } from './address-encoding';
import { ensureWasmInitialized as ensureWasmInit } from './wasm-utils';

const englishWords = new Set(wordlist);

/**
 * Generates a BIP-39 mnemonic (24 words)
 * Uses 256 bits of entropy for maximum security
 */
export function generateMnemonic(): string {
  return generateMnemonicScure(wordlist, 256);
}

/**
 * Validates a BIP-39 mnemonic
 * @param mnemonic - The mnemonic phrase to validate
 * @returns true if valid, false otherwise
 */
export function validateMnemonic(mnemonic: string): boolean {
  return validateMnemonicScure(mnemonic, wordlist);
}

export function normalizeAndValidateMnemonic(mnemonic: string): string | null {
  const trimmed = mnemonic.trim();
  if (!trimmed) return null;

  const canonicalWords: string[] = [];
  for (const rawToken of trimmed.split(/\s+/)) {
    if (!/^[A-Za-z]+$/.test(rawToken)) return null;

    const token = rawToken.toLowerCase();

    // Exact words take precedence over four-character prefix expansion.
    if (englishWords.has(token)) {
      canonicalWords.push(token);
      continue;
    }

    if (token.length !== 4) return null;

    let prefixMatch: string | null = null;
    for (const word of wordlist) {
      if (!word.startsWith(token)) continue;
      if (prefixMatch !== null) return null;
      prefixMatch = word;
    }

    if (prefixMatch === null) return null;
    canonicalWords.push(prefixMatch);
  }

  const canonicalMnemonic = canonicalWords.join(' ');
  return validateMnemonic(canonicalMnemonic) ? canonicalMnemonic : null;
}

/**
 * Derives a Nockchain v1 PKH address from the master key (no child derivation)
 * This matches the CLI wallet behavior
 * @param mnemonic - The BIP-39 mnemonic phrase
 * @returns A Base58-encoded Nockchain v1 PKH address (~60 characters)
 */
export async function deriveAddressFromMaster(mnemonic: string): Promise<string> {
  await ensureWasmInit();

  // Derive master key from mnemonic
  const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');

  // Use master key public key directly (no child derivation)
  const address = publicKeyToPKH(masterKey.publicKey);

  // Clean up WASM memory
  masterKey.free();

  return address;
}

/**
 * Derives a Nockchain v1 PKH address from a mnemonic using SLIP-10 child derivation
 * @param mnemonic - The BIP-39 mnemonic phrase
 * @param accountIndex - The account derivation index (default 0)
 * @returns A Base58-encoded Nockchain v1 PKH address (~60 characters)
 */
export async function deriveAddress(mnemonic: string, accountIndex: number = 0): Promise<string> {
  await ensureWasmInit();

  // Derive master key from mnemonic
  const masterKey = wasm.deriveMasterKeyFromMnemonic(mnemonic, '');

  // Derive child key at account index
  const childKey = masterKey.deriveChild(accountIndex);

  // Get the public key hash (PKH) for v1 addresses
  // v1 uses TIP5 hash of the public key, base58 encoded
  const address = publicKeyToPKH(childKey.publicKey);

  // Clean up WASM memory
  childKey.free();
  masterKey.free();

  return address;
}
