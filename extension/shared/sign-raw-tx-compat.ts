/**
 * Compatibility layer for signRawTx payloads from external dApps (e.g. NockSwap).
 *
 * Accepts protobuf or legacy formats from iris-wasm 0.1.x and converts to the
 * format expected by the extension's WASM (iris-wasm 0.2.x).
 *
 * @deprecated When all dApps migrate to iris-wasm 0.2.x, this module can be
 * removed. The extension will then expect canonical protobuf only.
 */

import * as guard from '@nockbox/iris-wasm/iris_wasm.guard';
import wasm from './sdk-wasm.js';

/**
 * Convert rawTx from protobuf or legacy format to wasm.RawTx.
 * Remove when all dApps use iris-wasm 0.2.x
 */
export function toRawTx(rawTx: unknown): wasm.RawTx {
  if (guard.isRawTx(rawTx)) {
    return rawTx;
  }
  if (guard.isPbCom2RawTransaction(rawTx)) {
    return wasm.rawTxFromProtobuf(rawTx);
  }
  throw new Error(
    'Raw transaction must be native RawTx or protobuf PbCom2RawTransaction'
  );
}

/**
 * Convert note from protobuf or legacy format to wasm.Note.
 * Remove when all dApps use iris-wasm 0.2.x
 */
export function toNote(note: unknown): wasm.Note {
  if (guard.isNote(note)) {
    return note;
  }
  if (guard.isPbCom2Note(note)) {
    return wasm.note_from_protobuf(note);
  }
  throw new Error('Note must be native Note or protobuf PbCom2Note');
}

/**
 * Convert spendCondition from protobuf or legacy format to wasm.SpendCondition.
 * Remove when all dApps use iris-wasm 0.2.x
 */
export function toSpendCondition(spendCondition: unknown): wasm.SpendCondition {
  if (guard.isSpendCondition(spendCondition)) {
    return spendCondition;
  }
  if (guard.isPbCom2SpendCondition(spendCondition)) {
    return wasm.spendConditionFromProtobuf(spendCondition);
  }
  throw new Error('Spend condition must be native SpendCondition or protobuf PbCom2SpendCondition');
}
