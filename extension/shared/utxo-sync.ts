/**
 * UTXO Sync - Orchestrates syncing local UTXO store with chain state
 *
 * This module coordinates between:
 * - RPC client (fetches chain state)
 * - UTXO store (local state management)
 * - UTXO diff (pure diff computation)
 * - Wallet transactions (tx lifecycle)
 */

import { queryV1Balance } from './balance-query';
import type { NockchainBrowserRPCClient } from './rpc-client-browser';
import type { StoredNote, FetchedUTXO, Note } from './types';
import {
  getAccountNotes,
  saveNotes,
  markNotesSpent,
  releaseInFlightNotes,
  noteToStoredNote,
  fetchedToStoredNote,
  withAccountLock,
  getWalletTransactions,
  updateWalletTransaction,
  getPendingOutgoingTransactions,
  generateNoteId,
} from './utxo-store';
import {
  computeUTXODiff,
  classifyNewUTXO,
  findExpiredTransactions,
  areTransactionInputsSpent,
  matchChangeOutputs,
} from './utxo-diff';
import { NOCK_TO_NICKS } from './constants';
import { base58 } from '@scure/base';

/** Transaction expiry timeout: 24 hours */
const TX_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Convert Note (from RPC) to FetchedUTXO (for diff computation)
 */
function noteToFetchedUTXO(note: Note): FetchedUTXO {
  const nameFirst = note.nameFirstBase58 || base58.encode(note.nameFirst);
  const nameLast = note.nameLastBase58 || base58.encode(note.nameLast);
  const sourceHash = note.sourceHash?.length > 0 ? base58.encode(note.sourceHash) : '';

  return {
    noteId: generateNoteId(nameFirst, nameLast),
    sourceHash,
    originPage: Number(note.originPage),
    assets: note.assets,
    nameFirst,
    nameLast,
    noteDataHashBase58: note.noteDataHashBase58 || '',
    protoNote: note.protoNote,
  };
}

/**
 * Sync UTXOs for a single account
 * This is the main sync function called by the background polling service
 *
 * @param accountAddress - Account to sync
 * @param rpcClient - RPC client for chain queries
 * @returns Summary of what changed
 */
export async function syncAccountUTXOs(
  accountAddress: string,
  rpcClient: NockchainBrowserRPCClient
): Promise<{
  newIncoming: number;
  newChange: number;
  spent: number;
  confirmed: number;
  expired: number;
}> {
  return withAccountLock(accountAddress, async () => {
    // 1. Fetch current UTXOs from chain
    const balanceResult = await queryV1Balance(accountAddress, rpcClient);
    const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
    const fetchedUTXOs = chainNotes.map(noteToFetchedUTXO);

    // 2. Get local state
    const localNotes = await getAccountNotes(accountAddress);
    const pendingTxs = await getPendingOutgoingTransactions(accountAddress);

    // 3. Compute diff
    const diff = computeUTXODiff(localNotes, fetchedUTXOs, pendingTxs);

    // 4. Process spent notes
    if (diff.nowSpent.length > 0) {
      const spentNoteIds = diff.nowSpent.map(n => n.noteId);
      await markNotesSpent(accountAddress, spentNoteIds);

      // Check if any pending transactions are now confirmed
      for (const tx of pendingTxs) {
        if (areTransactionInputsSpent(tx, diff.nowSpent)) {
          // Find change outputs for this transaction
          const changeNoteIds = matchChangeOutputs(tx, diff.newUTXOs, diff.isChangeMap);

          await updateWalletTransaction(accountAddress, tx.id, {
            status: 'confirmed',
            expectedChangeNoteIds: changeNoteIds,
          });
        }
      }
    }

    // 5. Process new UTXOs
    let newIncoming = 0;
    let newChange = 0;
    const newStoredNotes: StoredNote[] = [];

    for (const newUTXO of diff.newUTXOs) {
      const { isChange, walletTxId } = classifyNewUTXO(newUTXO, diff.isChangeMap);

      const storedNote = fetchedToStoredNote(newUTXO, accountAddress, 'available', isChange);

      if (isChange && walletTxId) {
        storedNote.pendingTxId = walletTxId; // Link to originating tx
        newChange++;
      } else {
        // For now, we DON'T create WalletTransaction records for incoming UTXOs.
        // This avoids confusing the user with "received" transactions that are actually change.
        // The balance will still update correctly, and users can see incoming on a block explorer.
        newIncoming++;
      }

      newStoredNotes.push(storedNote);
    }

    // Save new notes to store
    if (newStoredNotes.length > 0) {
      await saveNotes(accountAddress, newStoredNotes);
    }

    // 5b. Check for pending transactions whose inputs are ALREADY spent
    // This handles the case where inputs were marked spent in a previous sync
    // but the transaction wasn't confirmed (e.g., laptop closed mid-sync)
    let confirmedFromPreviousSpent = 0;
    const stillPendingTxs = pendingTxs.filter(
      tx => !areTransactionInputsSpent(tx, diff.nowSpent)
    );

    if (stillPendingTxs.length > 0) {
      // Get fresh notes to check against already-spent inputs
      const currentNotes = await getAccountNotes(accountAddress);
      const spentNoteIds = new Set(
        currentNotes.filter(n => n.state === 'spent').map(n => n.noteId)
      );

      for (const tx of stillPendingTxs) {
        if (!tx.inputNoteIds || tx.inputNoteIds.length === 0) continue;

        // Check if ALL inputs are already marked as spent in storage
        const allInputsSpent = tx.inputNoteIds.every(noteId => spentNoteIds.has(noteId));

        if (allInputsSpent) {
          await updateWalletTransaction(accountAddress, tx.id, {
            status: 'confirmed',
          });
          confirmedFromPreviousSpent++;
        }
      }
    }

    // 6. Handle expired transactions
    const allTxs = await getWalletTransactions(accountAddress);
    const expiredTxs = findExpiredTransactions(allTxs, TX_EXPIRY_MS);

    for (const expiredTx of expiredTxs) {
      // Release locked notes
      if (expiredTx.inputNoteIds && expiredTx.inputNoteIds.length > 0) {
        await releaseInFlightNotes(accountAddress, expiredTx.inputNoteIds);
      }

      // Mark transaction as expired
      await updateWalletTransaction(accountAddress, expiredTx.id, {
        status: 'expired',
      });
    }

    const confirmedFromNewSpent = pendingTxs.filter(tx => areTransactionInputsSpent(tx, diff.nowSpent)).length;

    return {
      newIncoming,
      newChange,
      spent: diff.nowSpent.length,
      confirmed: confirmedFromNewSpent + confirmedFromPreviousSpent,
      expired: expiredTxs.length,
    };
  });
}

/**
 * Initialize UTXO store for a newly created/imported account
 * Called on first unlock to bootstrap the local store
 *
 * @param accountAddress - Account to initialize
 * @param rpcClient - RPC client for chain queries
 */
export async function initializeAccountUTXOs(
  accountAddress: string,
  rpcClient: NockchainBrowserRPCClient
): Promise<void> {
  return withAccountLock(accountAddress, async () => {
    // Check if already initialized
    const existingNotes = await getAccountNotes(accountAddress);
    if (existingNotes.length > 0) {
      return;
    }

    // Fetch current UTXOs from chain
    const balanceResult = await queryV1Balance(accountAddress, rpcClient);
    const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

    // Convert to stored notes (all available, no incoming tx records on first init)
    const storedNotes: StoredNote[] = chainNotes.map(note =>
      noteToStoredNote(note, accountAddress, 'available')
    );

    // Save to store
    if (storedNotes.length > 0) {
      await saveNotes(accountAddress, storedNotes);
    }
  });
}

/**
 * Get balance summary for an account from local store
 * This is the source of truth for UI display
 *
 * Follows Bitcoin wallet convention: includes expected change from pending
 * transactions in the available balance. This makes the balance immediately
 * reflect (total - sent - fee) rather than (total - full_input_utxo).
 */
export async function getAccountBalanceSummary(accountAddress: string): Promise<{
  available: number;
  spendableNow: number;
  pendingOut: number;
  pendingChange: number;
  total: number;
  utxoCount: number;
  availableUtxoCount: number;
}> {
  const notes = await getAccountNotes(accountAddress);
  const pendingTxs = await getPendingOutgoingTransactions(accountAddress);

  const availableNotes = notes.filter(n => n.state === 'available');
  const pendingNotes = notes.filter(n => n.state === 'in_flight');

  const availableFromNotes = availableNotes.reduce((sum, n) => sum + n.assets, 0);
  const pendingOut = pendingNotes.reduce((sum, n) => sum + n.assets, 0);

  // Sum expected change from pending outgoing transactions
  // This is change that will come back to us after confirmation
  const pendingChange = pendingTxs.reduce((sum, tx) => sum + (tx.expectedChange || 0), 0);

  // Available balance includes expected change (Bitcoin wallet convention)
  const available = availableFromNotes + pendingChange;

  // Spendable now: only UTXOs that are actually available (not in_flight)
  // This is what can be used as inputs for a new transaction RIGHT NOW
  const spendableNow = availableFromNotes;

  return {
    available,
    spendableNow,
    pendingOut,
    pendingChange,
    total: availableFromNotes + pendingOut, // True total of all non-spent notes
    utxoCount: notes.filter(n => n.state !== 'spent').length,
    availableUtxoCount: availableNotes.length,
  };
}

/**
 * Force a full resync of an account's UTXOs
 * Useful for recovery scenarios or user-initiated refresh
 */
export async function forceResyncAccount(
  accountAddress: string,
  rpcClient: NockchainBrowserRPCClient
): Promise<void> {
  return withAccountLock(accountAddress, async () => {
    // Fetch current UTXOs from chain
    const balanceResult = await queryV1Balance(accountAddress, rpcClient);
    const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
    const fetchedUTXOs = chainNotes.map(noteToFetchedUTXO);

    // Get existing notes to preserve pending state
    const existingNotes = await getAccountNotes(accountAddress);

    // Build map of note IDs that are currently in pending transactions
    const pendingNoteIds = new Map<string, { state: StoredNote['state']; txId: string }>();
    for (const note of existingNotes) {
      if (note.state === 'in_flight' && note.pendingTxId) {
        pendingNoteIds.set(note.noteId, {
          state: note.state,
          txId: note.pendingTxId,
        });
      }
    }

    // Rebuild stored notes from chain state
    const newStoredNotes: StoredNote[] = [];

    for (const fetched of fetchedUTXOs) {
      const pending = pendingNoteIds.get(fetched.noteId);

      if (pending) {
        // Preserve pending state
        const storedNote = fetchedToStoredNote(fetched, accountAddress, pending.state);
        storedNote.pendingTxId = pending.txId;
        newStoredNotes.push(storedNote);
      } else {
        // New or available
        newStoredNotes.push(fetchedToStoredNote(fetched, accountAddress, 'available'));
      }
    }

    // Replace all notes (but keep pending state)
    await saveNotes(accountAddress, newStoredNotes);
  });
}
