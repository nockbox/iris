/**
 * Common spend condition builders for Nockchain v1.
 * Shared by transaction-builder and first-name-derivation.
 */

import wasm from './sdk-wasm.js';

/** Simple PKH lock (no timelock): [(pkh, m=1, hashes=[pkh])] — standard note. */
export function createSimplePkhCondition(pkhBase58: string): wasm.SpendCondition {
  return [{ Pkh: { m: 1, hashes: [pkhBase58] } }];
}

/** Base58 lock-root digest for a simple PKH spend condition. */
export function simplePkhLockRootBase58(pkhBase58: string): string {
  return wasm.spendConditionHash(createSimplePkhCondition(pkhBase58)) as string;
}

/** PKH + coinbase timelock: [(pkh), (tim, rel.min=timelockBlocks)]. Default 100 blocks. */
export function createPkhCoinbaseCondition(
  pkhBase58: string,
  timelockBlocks = 100
): wasm.SpendCondition {
  return [
    { Pkh: { m: 1, hashes: [pkhBase58] } },
    { Tim: { rel: { min: timelockBlocks, max: null }, abs: { min: null, max: null } } },
  ];
}

/** Base58 lock-root digest for a PKH + coinbase timelock spend condition. */
export function coinbasePkhLockRootBase58(
  pkhBase58: string,
  timelockBlocks: number
): string {
  return wasm.spendConditionHash(
    createPkhCoinbaseCondition(pkhBase58, timelockBlocks)
  ) as string;
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
