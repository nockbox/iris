/**
 * Memo decoding / extraction helpers for transaction approvals.
 *
 * The memo may be represented as:
 * - UTF-8 bytes (Uint8Array)
 * - base64 string
 * - hex string (optionally 0x-prefixed)
 * - nested "protobuf-ish" wrappers like { value: ... }
 *
 * We intentionally keep this resilient: the WASM/protobuf shape may evolve.
 */

import { base16, base64, base64url } from '@scure/base';
import type { Note as WasmNote, NoteDataEntry as WasmNoteDataEntry, RawTx as WasmRawTx } from '@nockbox/iris-wasm/iris_wasm.js';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function unwrapValue(x: unknown): unknown {
  if (!isRecord(x)) return x;
  // Common protobuf-ish wrapper: { value: ... }
  if ('value' in x && Object.keys(x).length === 1) return x.value;
  return x;
}

function hexToBytes(hex: string): Uint8Array | null {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(normalized)) return null;
  if (normalized.length % 2 !== 0) return null;
  try {
    // base16 expects hex without 0x prefix; normalize case for safety.
    return base16.decode(normalized.toLowerCase());
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array | null {
  const normalized = b64.trim();
  if (!normalized) return null;

  // Heuristics to avoid interpreting arbitrary plaintext as base64/base64url.
  // - base64: A–Z a–z 0–9 + / with optional = padding, length must be multiple of 4.
  // - base64url: A–Z a–z 0–9 - _ with optional padding; may be unpadded.
  const looksLikeB64 = /^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length % 4 === 0;
  const looksLikeB64Url = /^[A-Za-z0-9_-]+={0,2}$/.test(normalized);
  if (!looksLikeB64 && !looksLikeB64Url) return null;

  // Try strict decoders first; fall back to normalizing url-safe -> standard base64.
  try {
    if (looksLikeB64) return base64.decode(normalized);
    if (looksLikeB64Url) return base64url.decode(normalized);
  } catch {
    // continue
  }

  try {
    // Normalize base64url (unpadded) to standard base64 for maximum compatibility.
    let s = normalized.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad === 2) s += '==';
    else if (pad === 3) s += '=';
    else if (pad === 1) return null; // impossible length
    return base64.decode(s);
  } catch {
    return null;
  }
}

function bytesToUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    // Fallback (very old environments)
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
}

function decodeMemoValue(maybe: unknown): string | null {
  const v = unwrapValue(maybe);
  if (v == null) return null;

  if (v instanceof Uint8Array) {
    const decoded = bytesToUtf8(v).trim();
    return decoded.length ? decoded : null;
  }

  if (typeof v === 'string') {
    const raw = v.trim();
    if (!raw) return null;

    // If it's already readable, prefer returning it directly.
    // attempt decoding for base64/hex-ish strings in case it is hex
    const asHex = hexToBytes(raw);
    if (asHex) {
      const decoded = bytesToUtf8(asHex).trim();
      return decoded.length ? decoded : raw;
    }

    const asB64 = base64ToBytes(raw);
    if (asB64) {
      const decoded = bytesToUtf8(asB64).trim();
      return decoded.length ? decoded : raw;
    }

    return raw;
  }

  // Common protobuf-ish wrappers: { blob: Uint8Array | { value: ... } }
  if (isRecord(v)) {
    if ('blob' in v) return decodeMemoValue(v.blob);
    if ('memo' in v) return decodeMemoValue(v.memo);
  }

  return null;
}

type ProtobufNoteDataEntryLike = { key?: unknown; blob?: unknown };

function isWasmNote(note: unknown): note is WasmNote {
  return isRecord(note) && 'noteData' in note;
}

function getNoteDataEntries(note: WasmNote | unknown): ReadonlyArray<WasmNoteDataEntry | ProtobufNoteDataEntryLike> {
  // WASM path (strongly typed)
  if (isWasmNote(note)) {
    return note.noteData.entries;
  }

  // Protobuf-ish object path (resilient)
  if (!isRecord(note)) return [];
  const v1 = (note as any)?.note_version?.V1 ?? (note as any)?.noteVersion?.V1 ?? null;
  const noteData = v1?.note_data ?? v1?.noteData ?? null;
  const entries = noteData?.entries ?? noteData?.Entries ?? null;
  return Array.isArray(entries) ? (entries as ProtobufNoteDataEntryLike[]) : [];
}

function extractMemoFromOutputs(outputs: ReadonlyArray<WasmNote | unknown> | undefined): string | null {
  if (!outputs || !Array.isArray(outputs)) return null;

  for (const output of outputs) {
    const entries = getNoteDataEntries(output);
    for (const entry of entries) {
      const key = unwrapValue((entry as any)?.key);
      const keyStr = typeof key === 'string' ? key : null;
      if (!keyStr) continue;
      if (keyStr.toLowerCase() !== 'memo') continue;

      const memo = decodeMemoValue((entry as any)?.blob);
      if (memo) return memo;
    }
  }

  return null;
}

function extractMemoFromRawTx(rawTx: WasmRawTx | unknown): string | null {
  // Fast-path: common shapes
  const maybe = isRecord(rawTx) ? rawTx : (rawTx as unknown as Record<string, unknown>);
  const direct = decodeMemoValue((maybe as any)?.memo ?? (maybe as any)?.Memo);
  if (direct) return direct;

  // Some schemas may tuck memo under tx/body/etc.
  const nested = decodeMemoValue((maybe as any)?.tx?.memo ?? (maybe as any)?.body?.memo ?? (maybe as any)?.transaction?.memo);
  if (nested) return nested;

  // As a last resort, shallow scan for keys named "memo" (case-insensitive) up to a small depth.
  const queue: Array<{ obj: Record<string, unknown>; depth: number }> = [];
  if (isRecord(rawTx)) queue.push({ obj: rawTx, depth: 0 });
  const seen = new Set<object>();

  while (queue.length) {
    const { obj, depth } = queue.shift()!;
    if (seen.has(obj)) continue;
    seen.add(obj);

    for (const [k, val] of Object.entries(obj)) {
      if (k.toLowerCase() === 'memo') {
        const found = decodeMemoValue(val);
        if (found) return found;
      }
      if (depth < 3 && isRecord(val)) queue.push({ obj: val, depth: depth + 1 });
    }
  }

  return null;
}

/**
 * Extract a human-readable memo from a signRawTx payload.
 * Returns null if no memo exists.
 */
export function extractMemo(params: {
  rawTx: WasmRawTx | unknown;
  outputs?: ReadonlyArray<WasmNote | unknown>;
}): string | null {
  // Prefer explicit tx-level memo if present; otherwise fall back to note_data entries.
  return extractMemoFromRawTx(params.rawTx) ?? extractMemoFromOutputs(params.outputs);
}


