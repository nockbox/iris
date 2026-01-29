/**
 * UTXO utils
 */

import type {
  StoredNote,
  NoteState,
  FetchedUTXO,
  Note,
} from './types';
import { base58 } from '@scure/base';

// ============================================================================
// Per-Account Mutex - Prevents race conditions on rapid sends
// ============================================================================

const accountLocks = new Map<string, Promise<void>>();

/**
 * Execute a function with exclusive access to an account's UTXO state
 * Prevents race conditions when building multiple transactions rapidly
 *
 */
export async function withAccountLock<T>(accountAddress: string, fn: () => Promise<T>): Promise<T> {
  const prev = accountLocks.get(accountAddress) ?? Promise.resolve();
  let resolveNext: () => void;
  const next = new Promise<void>(res => {
    resolveNext = res;
  });
  accountLocks.set(
    accountAddress,
    prev.then(() => next)
  );

  await prev; // Wait for previous holder

  try {
    return await fn();
  } finally {
    resolveNext!();
  }
}

// ============================================================================
// Note ID Generation
// ============================================================================

/**
 * Generate a unique note ID from name components
 * Format: nameFirst:nameLast (both in base58)
 */
export function generateNoteId(nameFirst: string, nameLast: string): string {
  return `${nameFirst}:${nameLast}`;
}

/**
 * Convert Uint8Array to base58 string
 */
function uint8ArrayToBase58(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

// ============================================================================
// Conversion: Note (RPC) -> StoredNote
// ============================================================================

/**
 * Convert a Note from RPC response to StoredNote for storage
 */
export function noteToStoredNote(
  note: Note,
  accountAddress: string,
  state: NoteState = 'available'
): StoredNote {
  const nameFirst = note.nameFirstBase58 || uint8ArrayToBase58(note.nameFirst);
  const nameLast = note.nameLastBase58 || uint8ArrayToBase58(note.nameLast);
  const noteId = generateNoteId(nameFirst, nameLast);
  const sourceHash = note.sourceHash?.length > 0 ? uint8ArrayToBase58(note.sourceHash) : '';

  return {
    noteId,
    accountAddress,
    sourceHash,
    originPage: Number(note.originPage),
    assets: note.assets,
    nameFirst,
    nameLast,
    noteDataHashBase58: note.noteDataHashBase58 || '',
    protoNote: note.protoNote,
    state,
    discoveredAt: Date.now(),
  };
}

/**
 * Convert a FetchedUTXO to StoredNote
 *
 */
export function fetchedToStoredNote(
  fetched: FetchedUTXO,
  accountAddress: string,
  state: NoteState = 'available',
  isChange?: boolean
): StoredNote {
  return {
    noteId: fetched.noteId,
    accountAddress,
    sourceHash: fetched.sourceHash,
    originPage: fetched.originPage,
    assets: fetched.assets,
    nameFirst: fetched.nameFirst,
    nameLast: fetched.nameLast,
    noteDataHashBase58: fetched.noteDataHashBase58,
    protoNote: fetched.protoNote,
    state,
    isChange,
    discoveredAt: Date.now(),
  };
}
