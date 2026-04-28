/**
 * Common spend condition builders for Nockchain v1.
 * Shared by transaction-builder and first-name-derivation.
 */

import { base58 } from '@scure/base';
import { guard } from '@nockbox/iris-sdk/wasm';
import wasm from './sdk-wasm.js';

export function parseDigestString(value: string): wasm.Digest {
  const bytes = base58.decode(value);
  if (bytes.length !== 40) {
    throw new Error(`Invalid digest length: ${bytes.length}, expected 40 bytes`);
  }
  if (!guard.isDigest(value)) {
    throw new Error('Invalid digest encoding');
  }
  return value;
}

function toBlockHeight(value: number): wasm.BlockHeight {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid block height: ${value}`);
  }
  return value as wasm.BlockHeight;
}

/** Simple PKH lock (no timelock) — standard note. */
export function createSimplePkhCondition(pkhBase58: string): wasm.SpendCondition {
  const pkh = wasm.pkhSingle(parseDigestString(pkhBase58));
  return wasm.spendConditionNewPkh(pkh);
}

function timPrimitive(
  relMin: number | null,
  relMax: number | null,
  absMin: number | null,
  absMax: number | null
): wasm.LockPrimitive {
  return {
    tag: 'tim',
    rel: {
      min: relMin === null ? null : toBlockHeight(relMin),
      max: relMax === null ? null : toBlockHeight(relMax),
    },
    abs: {
      min: absMin === null ? null : toBlockHeight(absMin),
      max: absMax === null ? null : toBlockHeight(absMax),
    },
  };
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
  const pkhSc = wasm.spendConditionNewPkh(wasm.pkhSingle(parseDigestString(pkhBase58)));
  return [...pkhSc, timPrimitive(timelockBlocks, null, null, null)];
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
  const pkhSc = wasm.spendConditionNewPkh(wasm.pkhSingle(parseDigestString(pkhBase58)));
  return [...pkhSc, timPrimitive(Number(blocks), null, null, null)];
}

/** PKH + absolute timelock (min height). */
export function createPkhAbsoluteTimelockCondition(
  pkhBase58: string,
  minHeight: bigint
): wasm.SpendCondition {
  const pkhSc = wasm.spendConditionNewPkh(wasm.pkhSingle(parseDigestString(pkhBase58)));
  return [...pkhSc, timPrimitive(null, null, Number(minHeight), null)];
}
