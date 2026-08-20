/**
 * UTXO utils
 */

import type { StoredNote, NoteState, FetchedUTXO, Note, WalletTransaction } from './types';
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
 * Atomically reserve an exact input set. Every input is preflighted before any
 * note is mutated, preventing a stale input from leaving a partial reservation.
 */
export function reserveAvailableNotes(
  notes: StoredNote[],
  accountAddress: string,
  noteIds: readonly string[],
  walletTxId: string
): void {
  const uniqueNoteIds = [...new Set(noteIds)];
  if (uniqueNoteIds.length === 0 || uniqueNoteIds.length !== noteIds.length) {
    throw new Error('Transaction input set is empty or contains duplicates');
  }

  const notesById = new Map(notes.map(note => [note.noteId, note]));
  const toReserve = uniqueNoteIds.map(noteId => {
    const note = notesById.get(noteId);
    if (!note || note.accountAddress !== accountAddress) {
      throw new Error(`Cannot reserve note ${noteId}: input is not owned by the selected account`);
    }
    if (note.state !== 'available') {
      throw new Error(`Cannot reserve note ${noteId}: state is ${note.state}`);
    }
    return note;
  });

  for (const note of toReserve) {
    note.state = 'in_flight';
    note.pendingTxId = walletTxId;
  }
}

/** Release only reservations owned by the transaction being cleaned up. */
export function releaseOwnedNoteReservations(
  notes: StoredNote[],
  accountAddress: string,
  noteIds: readonly string[],
  walletTxId: string
): number {
  const noteIdSet = new Set(noteIds);
  let released = 0;
  for (const note of notes) {
    if (
      noteIdSet.has(note.noteId) &&
      note.accountAddress === accountAddress &&
      note.state === 'in_flight' &&
      note.pendingTxId === walletTxId
    ) {
      note.state = 'available';
      delete note.pendingTxId;
      released += 1;
    }
  }
  return released;
}

/**
 * Stage one exact-send reservation and its history record as a single in-memory
 * change. The returned rollback restores both collections if their one durable
 * snapshot fails to persist.
 */
export function stageExactTransactionReservation(
  notes: StoredNote[],
  transactions: WalletTransaction[],
  accountAddress: string,
  noteIds: readonly string[],
  walletTx: WalletTransaction
): { rollback: () => void } {
  if (walletTx.accountAddress !== accountAddress || walletTx.direction !== 'outgoing') {
    throw new Error('Transaction reservation account does not match its history record');
  }
  if (transactions.some(transaction => transaction.id === walletTx.id)) {
    throw new Error(`Transaction ${walletTx.id} already exists`);
  }

  reserveAvailableNotes(notes, accountAddress, noteIds, walletTx.id);
  transactions.unshift(walletTx);

  let active = true;
  return {
    rollback: () => {
      if (!active) return;
      active = false;
      releaseOwnedNoteReservations(notes, accountAddress, noteIds, walletTx.id);
      const stagedIndex = transactions.findIndex(
        transaction => transaction === walletTx || transaction.id === walletTx.id
      );
      if (stagedIndex !== -1) {
        transactions.splice(stagedIndex, 1);
      }
    },
  };
}

/** Stage additional inputs for an existing wallet-owned submission. */
export function stageAdditionalTransactionReservation(
  notes: StoredNote[],
  transaction: WalletTransaction,
  accountAddress: string,
  noteIds: readonly string[]
): { rollback: () => void } {
  const previousInputNoteIds = transaction.inputNoteIds ? [...transaction.inputNoteIds] : undefined;
  reserveAvailableNotes(notes, accountAddress, noteIds, transaction.id);
  transaction.inputNoteIds = [...new Set([...(transaction.inputNoteIds ?? []), ...noteIds])];

  return {
    rollback: () => {
      releaseOwnedNoteReservations(notes, accountAddress, noteIds, transaction.id);
      transaction.inputNoteIds = previousInputNoteIds;
    },
  };
}

const ACTIVE_RESERVATION_STATUSES = new Set<WalletTransaction['status']>([
  'created',
  'broadcast_pending',
  'mempool_seen',
  'broadcasted_unconfirmed',
]);

/**
 * Recover legacy/crash-gap reservations only after a successful chain query
 * confirms the input is still unspent. Active transaction owners are retained.
 */
export function releaseUnownedOnChainReservations(
  notes: StoredNote[],
  transactions: readonly WalletTransaction[],
  accountAddress: string,
  onChainNoteIds: ReadonlySet<string>
): number {
  const activeReservationOwners = new Set<string>();
  for (const transaction of transactions) {
    if (
      transaction.accountAddress === accountAddress &&
      transaction.direction === 'outgoing' &&
      ACTIVE_RESERVATION_STATUSES.has(transaction.status)
    ) {
      activeReservationOwners.add(transaction.id);
    }
  }

  let released = 0;
  for (const note of notes) {
    if (
      note.accountAddress !== accountAddress ||
      note.state !== 'in_flight' ||
      !onChainNoteIds.has(note.noteId)
    ) {
      continue;
    }
    if (note.pendingTxId && activeReservationOwners.has(note.pendingTxId)) continue;

    note.state = 'available';
    delete note.pendingTxId;
    released += 1;
  }
  return released;
}

/**
 * An exact-send record still in `created` with no chain id after a process
 * restart cannot have crossed this path's pre-broadcast persistence boundary.
 */
export function recoverInterruptedExactReservations(
  notes: StoredNote[],
  transactions: WalletTransaction[],
  accountAddress: string,
  now = Date.now()
): { released: number; failed: number } {
  let released = 0;
  let failed = 0;
  for (const transaction of transactions) {
    if (
      transaction.accountAddress !== accountAddress ||
      transaction.direction !== 'outgoing' ||
      transaction.status !== 'created' ||
      (!transaction.exactIntentId && !transaction.locallyManagedSubmission) ||
      transaction.txHash ||
      transaction.trackingTxId
    ) {
      continue;
    }

    released += releaseOwnedNoteReservations(
      notes,
      accountAddress,
      transaction.inputNoteIds ?? [],
      transaction.id
    );
    transaction.status = 'failed';
    transaction.updatedAt = now;
    failed += 1;
  }
  return { released, failed };
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
