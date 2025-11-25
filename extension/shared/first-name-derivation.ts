/**
 * First-name derivation utilities for Nockchain v1 notes
 *
 * In Nockchain v1, notes are indexed by "first-names" which are deterministically
 * derived from their lock conditions. This module provides functions to calculate
 * the expected first-name for standard lock types (simple PKH and coinbase).
 */

import * as wasm from '@nockbox/iris-wasm/iris_wasm.js';
import { ensureWasmInitialized } from './wasm-utils.js';

/**
 * Derives the first-name for a simple PKH-locked note
 *
 * This is used for regular transaction outputs (non-coinbase).
 * The lock structure is: [(pkh, m=1, hashes=[your_pkh])]
 *
 * @param pkhBase58 - The base58-encoded PKH digest (~55 chars)
 * @returns The base58-encoded first-name hash (40 bytes encoded)
 *
 * @example
 * ```typescript
 * const myPKH = "2R7Z8p..."; // Your v1 PKH address
 * const firstName = await deriveSimpleFirstName(myPKH);
 * // Use firstName to query notes via gRPC API
 * ```
 */
export async function deriveSimpleFirstName(pkhBase58: string): Promise<string> {
  await ensureWasmInitialized();

  // Validate PKH is a non-empty string
  if (!pkhBase58 || typeof pkhBase58 !== 'string') {
    throw new Error('PKH must be a non-empty base58 string');
  }

  console.log('[First-Name] Input PKH:', {
    length: pkhBase58.length,
    full: pkhBase58,
  });

  // Create a simple PKH-only spend condition
  const pkh = wasm.Pkh.single(pkhBase58);
  const condition = wasm.SpendCondition.newPkh(pkh);

  // Get the first-name from the spend condition
  const firstNameDigest = condition.firstName();
  const firstNameBase58 = firstNameDigest.value;

  console.log('[First-Name] ✅ Derived simple first-name:', {
    length: firstNameBase58.length,
    full: firstNameBase58,
  });

  // Verify it's the right length (40 bytes → ~55 chars base58)
  if (firstNameBase58.length < 50 || firstNameBase58.length > 60) {
    console.warn(
      `[First-Name] ⚠️ WARNING: First-name length ${firstNameBase58.length} is outside expected range 50-60 chars`
    );
  }

  return firstNameBase58;
}

/**
 * Derives the first-name for a coinbase (mining reward) note
 *
 * This is used for mining rewards which include both a PKH lock and a timelock.
 * The lock structure is: [(pkh, m=1, hashes=[your_pkh]), (tim, timelock)]
 *
 * @param pkhBase58 - The base58-encoded PKH digest (~55 chars)
 * @returns The base58-encoded first-name hash (40 bytes encoded)
 *
 * @example
 * ```typescript
 * const myPKH = "2R7Z8p..."; // Your v1 PKH address
 * const firstName = await deriveCoinbaseFirstName(myPKH);
 * // Use firstName to query mining rewards via gRPC API
 * ```
 */
export async function deriveCoinbaseFirstName(pkhBase58: string): Promise<string> {
  await ensureWasmInitialized();

  // Validate PKH is a non-empty string
  if (!pkhBase58 || typeof pkhBase58 !== 'string') {
    throw new Error('PKH must be a non-empty base58 string');
  }

  // Create PKH + TIM (coinbase) spend condition
  const pkhLeaf = wasm.LockPrimitive.newPkh(wasm.Pkh.single(pkhBase58));
  const timLeaf = wasm.LockPrimitive.newTim(wasm.LockTim.coinbase());
  const condition = new wasm.SpendCondition([pkhLeaf, timLeaf]);

  // Get the first-name from the spend condition
  const firstNameDigest = condition.firstName();
  const firstNameBase58 = firstNameDigest.value;

  console.log('[First-Name] ✅ Derived coinbase first-name:', {
    length: firstNameBase58.length,
    full: firstNameBase58,
  });

  // Verify it's the right length (40 bytes → ~55 chars base58)
  if (firstNameBase58.length < 50 || firstNameBase58.length > 60) {
    console.warn(
      `[First-Name] ⚠️ WARNING: Coinbase first-name length ${firstNameBase58.length} is outside expected range 50-60 chars`
    );
  }

  return firstNameBase58;
}

/**
 * Helper to get both first-names for a given PKH address
 *
 * Returns both simple and coinbase first-names so you can query
 * both regular transaction outputs and mining rewards in a single call.
 *
 * @param pkhBase58 - The base58-encoded PKH address (~55 chars)
 * @returns Object containing both first-names
 *
 * @example
 * ```typescript
 * const myPKH = "2R7Z8p...";
 * const { simple, coinbase } = await getBothFirstNames(myPKH);
 *
 * // Query both types of notes
 * const [simpleNotes, coinbaseNotes] = await Promise.all([
 *   queryNotesByFirstName(simple),
 *   queryNotesByFirstName(coinbase),
 * ]);
 * ```
 */
export async function getBothFirstNames(pkhBase58: string): Promise<{
  simple: string;
  coinbase: string;
}> {
  await ensureWasmInitialized();

  return {
    simple: await deriveSimpleFirstName(pkhBase58),
    coinbase: await deriveCoinbaseFirstName(pkhBase58),
  };
}
