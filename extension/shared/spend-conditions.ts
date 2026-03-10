/**
 * Common spend condition builders for Nockchain v1.
 * Shared by transaction-builder and first-name-derivation.
 */

import wasm from './sdk-wasm.js';

/** Simple PKH lock (no timelock) — standard note. */
export function createSimplePkhCondition(pkhBase58: string): wasm.SpendCondition {
  const pkh = wasm.pkhSingle(pkhBase58);
  return wasm.spendConditionNewPkh(pkh);
}

function timPrimitive(relMin: number | null, relMax: number | null, absMin: number | null, absMax: number | null): wasm.LockPrimitive {
  return { tag: 'tim', rel: { min: relMin, max: relMax }, abs: { min: absMin, max: absMax } };
}

/** PKH + coinbase timelock: [(pkh), (tim, rel.min=timelockBlocks)]. Default 100 blocks. */
export function createPkhCoinbaseCondition(
  pkhBase58: string,
  timelockBlocks = 100
): wasm.SpendCondition {
  const pkhSc = wasm.spendConditionNewPkh(wasm.pkhSingle(pkhBase58));
  return [...pkhSc, timPrimitive(timelockBlocks, null, null, null)];
}

/** PKH + relative timelock (min blocks). */
export function createPkhRelativeTimelockCondition(
  pkhBase58: string,
  blocks: bigint
): wasm.SpendCondition {
  const pkhSc = wasm.spendConditionNewPkh(wasm.pkhSingle(pkhBase58));
  return [...pkhSc, timPrimitive(Number(blocks), null, null, null)];
}

/** PKH + absolute timelock (min height). */
export function createPkhAbsoluteTimelockCondition(
  pkhBase58: string,
  minHeight: bigint
): wasm.SpendCondition {
  const pkhSc = wasm.spendConditionNewPkh(wasm.pkhSingle(pkhBase58));
  return [...pkhSc, timPrimitive(null, null, Number(minHeight), null)];
}
