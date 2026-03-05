/**
 * Protobuf ↔ native conversion for signRawTx at the RPC boundary.
 * dApps send protobuf; we convert to native in the background, use native in the vault.
 */

import * as guard from '@nockbox/iris-sdk/iris_wasm.guard';
import wasm from './sdk-wasm.js';

/** Convert protobuf rawTx to native. Used at RPC boundary only. */
export function toRawTx(rawTx: unknown): wasm.RawTx {
  if (!guard.isPbCom2RawTransaction(rawTx)) {
    throw new Error('Raw transaction must be protobuf PbCom2RawTransaction');
  }
  return wasm.rawTxFromProtobuf(rawTx);
}

/** Convert protobuf note to native. Used at RPC boundary only. */
export function toNote(note: unknown): wasm.Note {
  if (!guard.isPbCom2Note(note)) {
    throw new Error('Note must be protobuf PbCom2Note');
  }
  return wasm.noteFromProtobuf(note);
}

/** Convert protobuf spendCondition to native. Used at RPC boundary only. */
export function toSpendCondition(spendCondition: unknown): wasm.SpendCondition {
  if (!guard.isPbCom2SpendCondition(spendCondition)) {
    throw new Error('Spend condition must be protobuf PbCom2SpendCondition');
  }
  return wasm.spendConditionFromProtobuf(spendCondition);
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
