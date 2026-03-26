/**
 * Native helpers for signTx at the RPC boundary.
 */

import * as guard from '@nockbox/iris-wasm/iris_wasm.guard';
import type { SignTxRequest } from '@nockbox/iris-sdk';
import wasm from './sdk-wasm.js';

export function isSignTxRequest(obj: unknown): obj is SignTxRequest {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as { tx?: unknown; notes?: unknown };
  return (
    guard.isNockchainTx(p.tx) &&
    (typeof p.notes === 'undefined' ||
      (Array.isArray(p.notes) && p.notes.every((note: unknown) => guard.isNote(note))))
  );
}

/** Convert native note to protobuf for popup display. */
export function noteToProtobuf(note: wasm.Note): unknown {
  return wasm.noteToProtobuf(note);
}

/** Assert value is native RawTx; throw if not. Use after boundary conversion. */
export function assertNativeRawTx(rawTx: unknown): asserts rawTx is wasm.RawTx {
  if (!guard.isRawTx(rawTx)) {
    throw new Error('Expected native RawTx');
  }
}

/** Assert value is native Note; throw if not. */
export function assertNativeNote(note: unknown): asserts note is wasm.Note {
  if (!guard.isNote(note)) {
    throw new Error('Expected native Note');
  }
}

/** Assert value is native SpendCondition; throw if not. */
export function assertNativeSpendCondition(sc: unknown): asserts sc is wasm.SpendCondition {
  if (!guard.isSpendCondition(sc)) {
    throw new Error('Expected native SpendCondition');
  }
}
