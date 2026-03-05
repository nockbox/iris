/**
 * Common spend condition builders for Nockchain v1.
 * Shared by transaction-builder and first-name-derivation.
 */

import wasm from './sdk-wasm.js';

/** Simple PKH lock (no timelock): [(pkh, m=1, hashes=[pkh])] — standard note. */
export function createSimplePkhCondition(pkhBase58: string): wasm.SpendCondition {
  return [{ Pkh: { m: 1, hashes: [pkhBase58] } }];
}

/** PKH + coinbase timelock (100 blocks): [(pkh), (tim, rel.min=100)]. */
export function createPkhCoinbaseCondition(pkhBase58: string): wasm.SpendCondition {
  return [
    { Pkh: { m: 1, hashes: [pkhBase58] } },
    { Tim: { rel: { min: 100, max: null }, abs: { min: null, max: null } } },
  ];
}

/** PKH + relative timelock (min blocks). */
export function createPkhRelativeTimelockCondition(
  pkhBase58: string,
  blocks: bigint
): wasm.SpendCondition {
  return [
    { Pkh: { m: 1, hashes: [pkhBase58] } },
    { Tim: { rel: { min: Number(blocks), max: null }, abs: { min: null, max: null } } },
  ];
}

/** PKH + absolute timelock (min height). */
export function createPkhAbsoluteTimelockCondition(
  pkhBase58: string,
  minHeight: bigint
): wasm.SpendCondition {
  return [
    { Pkh: { m: 1, hashes: [pkhBase58] } },
    { Tim: { rel: { min: null, max: null }, abs: { min: Number(minHeight), max: null } } },
  ];
}
