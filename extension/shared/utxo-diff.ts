/**
 * UTXO Diff - Pure functions for computing UTXO state changes
 *
 * This module contains NO storage operations or chrome APIs.
 * It's purely functional, making it easy to test.
 */

import type {
  StoredNote,
  FetchedUTXO,
  UTXODiff,
  WalletTransaction,
} from './types';

/**
 * Compute the diff between local UTXO store and fetched chain state
 *
 * @param localNotes - Notes currently in our local store
 * @param fetchedUTXOs - UTXOs fetched from the chain
 * @param pendingOutgoingTxs - Our pending outgoing transactions (to identify change)
 * @returns Diff result with new, unchanged, and spent notes
 */
export function computeUTXODiff(
  localNotes: StoredNote[],
  fetchedUTXOs: FetchedUTXO[],
  pendingOutgoingTxs: WalletTransaction[]
): UTXODiff {
  // Build lookup maps
  const localMap = new Map<string, StoredNote>();
  for (const note of localNotes) {
    localMap.set(note.noteId, note);
  }

  const fetchedMap = new Map<string, FetchedUTXO>();
  for (const utxo of fetchedUTXOs) {
    fetchedMap.set(utxo.noteId, utxo);
  }

  // Build set of our pending tx hashes to identify change
  const ourPendingTxHashes = new Set<string>();
  const txHashToTxId = new Map<string, string>();
  for (const tx of pendingOutgoingTxs) {
    if (tx.txHash) {
      ourPendingTxHashes.add(tx.txHash);
      txHashToTxId.set(tx.txHash, tx.id);
    }
  }

  // Compute diff
  const newUTXOs: FetchedUTXO[] = [];
  const stillUnspent: StoredNote[] = [];
  const nowSpent: StoredNote[] = [];
  const isChangeMap = new Map<string, string>();

  // Find new UTXOs (on chain but not in local store)
  for (const [noteId, fetched] of fetchedMap) {
    const local = localMap.get(noteId);

    if (!local) {
      // This is a new UTXO we haven't seen before
      newUTXOs.push(fetched);

      // Check if this is change from one of our pending transactions
      if (fetched.sourceHash && ourPendingTxHashes.has(fetched.sourceHash)) {
        const walletTxId = txHashToTxId.get(fetched.sourceHash);
        if (walletTxId) {
          isChangeMap.set(noteId, walletTxId);
        }
      }
    } else if (local.state !== 'spent') {
      // Still exists on chain and in our store
      stillUnspent.push(local);
    }
  }

  // Find spent notes (in local store but not on chain)
  for (const [noteId, local] of localMap) {
    // Skip already-spent notes (we're tracking state, not presence)
    if (local.state === 'spent') {
      continue;
    }

    if (!fetchedMap.has(noteId)) {
      // Note was in our store but is no longer on chain = spent
      nowSpent.push(local);
    }
  }

  return {
    newUTXOs,
    stillUnspent,
    nowSpent,
    isChangeMap,
  };
}

/**
 * Classify a new UTXO as incoming payment vs change
 *
 * @param newUTXO - The new UTXO to classify
 * @param isChangeMap - Map from computeUTXODiff identifying change UTXOs
 * @returns { isChange: boolean, walletTxId?: string }
 */
export function classifyNewUTXO(
  newUTXO: FetchedUTXO,
  isChangeMap: Map<string, string>
): { isChange: boolean; walletTxId?: string } {
  const walletTxId = isChangeMap.get(newUTXO.noteId);
  if (walletTxId) {
    return { isChange: true, walletTxId };
  }
  return { isChange: false };
}

/**
 * Filter notes by state
 */
export function filterNotesByState(
  notes: StoredNote[],
  state: StoredNote['state']
): StoredNote[] {
  return notes.filter(n => n.state === state);
}

/**
 * Get notes that are locked by a specific transaction
 */
export function getNotesForTransaction(
  notes: StoredNote[],
  walletTxId: string
): StoredNote[] {
  return notes.filter(n => n.pendingTxId === walletTxId);
}

/**
 * Check if any notes are expired (in_flight for too long)
 *
 * @param notes - Notes to check
 * @param maxAgeMs - Maximum age in milliseconds before considered expired
 * @returns Notes that have been pending too long
 */
export function findExpiredNotes(
  notes: StoredNote[],
  maxAgeMs: number
): StoredNote[] {
  const now = Date.now();
  return notes.filter(note => {
    if (note.state !== 'in_flight') {
      return false;
    }
    // Use discoveredAt as proxy for when the note was locked
    // In practice, we'd want a separate lockedAt timestamp
    return now - note.discoveredAt > maxAgeMs;
  });
}

/**
 * Find transactions that should be marked as expired
 *
 * @param transactions - Wallet transactions to check
 * @param maxAgeMs - Maximum age before expiry
 * @returns Transactions that have exceeded the timeout
 */
export function findExpiredTransactions(
  transactions: WalletTransaction[],
  maxAgeMs: number
): WalletTransaction[] {
  const now = Date.now();
  return transactions.filter(tx => {
    // Only check pending states
    if (
      tx.status !== 'created' &&
      tx.status !== 'broadcast_pending' &&
      tx.status !== 'broadcasted_unconfirmed'
    ) {
      return false;
    }
    return now - tx.createdAt > maxAgeMs;
  });
}

/**
 * Check if a transaction's inputs have been spent
 * Used to detect confirmation when we see input notes disappear from chain
 *
 * @param tx - The transaction to check
 * @param nowSpent - Notes that are no longer on chain
 * @returns true if all inputs are spent
 */
export function areTransactionInputsSpent(
  tx: WalletTransaction,
  nowSpent: StoredNote[]
): boolean {
  if (!tx.inputNoteIds || tx.inputNoteIds.length === 0) {
    return false;
  }

  const spentNoteIds = new Set(nowSpent.map(n => n.noteId));
  return tx.inputNoteIds.every(noteId => spentNoteIds.has(noteId));
}

/**
 * Match expected change to actual new UTXOs
 * This is called after a transaction confirms to link change outputs
 *
 * @param tx - The confirmed transaction
 * @param newUTXOs - New UTXOs discovered in this sync
 * @param isChangeMap - Map identifying which new UTXOs are change
 * @returns Note IDs that are confirmed change for this transaction
 */
export function matchChangeOutputs(
  tx: WalletTransaction,
  newUTXOs: FetchedUTXO[],
  isChangeMap: Map<string, string>
): string[] {
  const changeNoteIds: string[] = [];

  for (const utxo of newUTXOs) {
    const matchedTxId = isChangeMap.get(utxo.noteId);
    if (matchedTxId === tx.id) {
      changeNoteIds.push(utxo.noteId);
    }
  }

  return changeNoteIds;
}
