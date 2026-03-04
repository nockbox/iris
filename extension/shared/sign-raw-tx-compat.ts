/**
 * Compatibility layer for signRawTx payloads from external dApps (e.g. NockSwap).
 *
 * Accepts protobuf or legacy formats from iris-wasm 0.1.x and converts to the
 * format expected by the extension's WASM (iris-wasm 0.2.x).
 *
 * @deprecated When all dApps migrate to iris-wasm 0.2.x, this module can be
 * removed. The extension will then expect canonical protobuf only.
 */

import wasm from './sdk-wasm.js';

function parseHeight(value: { value: string } | null | undefined): number | null {
  if (!value?.value) {
    return null;
  }
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function protobufSpendConditionToNative(
  protobufSpendCondition: wasm.PbCom2SpendCondition
): wasm.SpendCondition {
  return (protobufSpendCondition.primitives || []).map(primitive => {
    const kind = primitive?.primitive;
    if (!kind) {
      throw new Error('Invalid protobuf spend condition primitive');
    }

    if ('Pkh' in kind) {
      return {
        Pkh: {
          m: kind.Pkh.m,
          hashes: kind.Pkh.hashes || [],
        },
      };
    }

    if ('Tim' in kind) {
      return {
        Tim: {
          rel: {
            min: parseHeight(kind.Tim.rel?.min),
            max: parseHeight(kind.Tim.rel?.max),
          },
          abs: {
            min: parseHeight(kind.Tim.abs?.min),
            max: parseHeight(kind.Tim.abs?.max),
          },
        },
      };
    }

    if ('Burn' in kind) {
      return 'Brn';
    }

    if ('Hax' in kind) {
      return {
        Hax: (kind.Hax.hashes || []).map(hash => {
          if (!hash) {
            throw new Error('Invalid Hax hash in protobuf spend condition');
          }
          return wasm.digest_from_protobuf(hash);
        }),
      };
    }

    throw new Error('Unknown protobuf spend condition primitive type');
  });
}

/**
 * Convert rawTx from protobuf or legacy format to wasm.RawTx.
 * @deprecated Remove when all dApps use iris-wasm 0.2.x
 */
export function toRawTx(rawTx: unknown): wasm.RawTx {
  const asProtobuf =
    rawTx && typeof rawTx === 'object' && typeof (rawTx as { toProtobuf?: () => unknown }).toProtobuf === 'function'
      ? (rawTx as { toProtobuf: () => unknown }).toProtobuf()
      : rawTx;
  try {
    return wasm.rawTxFromProtobuf(asProtobuf as wasm.PbCom2RawTransaction);
  } catch {
    if (rawTx && typeof rawTx === 'object' && 'spends' in rawTx) {
      return rawTx as wasm.RawTx;
    }
    throw new Error(
      'Raw transaction must be protobuf or have .toProtobuf(); data did not match any variant of RawTx'
    );
  }
}

/**
 * Convert note from protobuf or legacy format to wasm.Note.
 * @deprecated Remove when all dApps use iris-wasm 0.2.x
 */
export function toNote(note: unknown): wasm.Note {
  if (note && typeof note === 'object' && ('version' in note || 'inner' in note)) {
    return note as wasm.Note;
  }
  if (note && typeof note === 'object' && typeof (note as { toProtobuf?: () => unknown }).toProtobuf === 'function') {
    return wasm.note_from_protobuf((note as { toProtobuf: () => unknown }).toProtobuf() as wasm.PbCom2Note);
  }
  return wasm.note_from_protobuf(note as wasm.PbCom2Note);
}

/**
 * Convert spendCondition from protobuf or legacy format to wasm.SpendCondition.
 * @deprecated Remove when all dApps use iris-wasm 0.2.x
 */
export function toSpendCondition(spendCondition: unknown): wasm.SpendCondition {
  if (
    Array.isArray(spendCondition) &&
    (spendCondition.length === 0 || !(spendCondition[0] && typeof spendCondition[0] === 'object' && 'primitive' in spendCondition[0]))
  ) {
    return spendCondition as wasm.SpendCondition;
  }
  if (
    spendCondition &&
    typeof spendCondition === 'object' &&
    Array.isArray((spendCondition as wasm.PbCom2SpendCondition).primitives)
  ) {
    return protobufSpendConditionToNative(spendCondition as wasm.PbCom2SpendCondition);
  }
  if (
    spendCondition &&
    typeof spendCondition === 'object' &&
    typeof (spendCondition as { toProtobuf?: () => unknown }).toProtobuf === 'function'
  ) {
    return toSpendCondition((spendCondition as { toProtobuf: () => unknown }).toProtobuf());
  }
  throw new Error('Expected spend condition in new API shape (LockPrimitive[])');
}
