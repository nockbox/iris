import { describe, expect, it } from 'vitest';
import type { StoredNote } from './types';
import type { WalletTransaction } from './types';
import {
  releaseOwnedNoteReservations,
  releaseUnownedOnChainReservations,
  recoverInterruptedExactReservations,
  stageAdditionalTransactionReservation,
  reserveAvailableNotes,
  stageExactTransactionReservation,
} from './utxo-utils';

const ACCOUNT = 'account-a';

function storedNote(
  noteId: string,
  state: StoredNote['state'] = 'available',
  pendingTxId?: string,
  accountAddress = ACCOUNT
): StoredNote {
  return {
    noteId,
    accountAddress,
    sourceHash: `source-${noteId}`,
    originPage: 1,
    assets: 100,
    nameFirst: `first-${noteId}`,
    nameLast: `last-${noteId}`,
    noteDataHashBase58: `data-${noteId}`,
    protoNote: {},
    state,
    pendingTxId,
    discoveredAt: 1,
  };
}

function walletTransaction(
  id: string,
  inputNoteIds: string[],
  status: WalletTransaction['status'] = 'created'
): WalletTransaction {
  return {
    id,
    accountAddress: ACCOUNT,
    direction: 'outgoing',
    createdAt: 1,
    updatedAt: 1,
    status,
    inputNoteIds,
  };
}

describe('exact note reservations', () => {
  it('preflights every input before mutating any note', () => {
    const available = storedNote('available');
    const alreadyReserved = storedNote('reserved', 'in_flight', 'other-transaction');
    const notes = [available, alreadyReserved];

    expect(() =>
      reserveAvailableNotes(notes, ACCOUNT, ['available', 'reserved'], 'new-transaction')
    ).toThrow('state is in_flight');

    expect(available).toMatchObject({ state: 'available', pendingTxId: undefined });
    expect(alreadyReserved).toMatchObject({
      state: 'in_flight',
      pendingTxId: 'other-transaction',
    });
  });

  it('rejects foreign and duplicate inputs without partial reservation', () => {
    const local = storedNote('local');
    const foreign = storedNote('foreign', 'available', undefined, 'account-b');

    expect(() =>
      reserveAvailableNotes([local, foreign], ACCOUNT, ['local', 'foreign'], 'new-transaction')
    ).toThrow('not owned');
    expect(local.state).toBe('available');

    expect(() =>
      reserveAvailableNotes([local], ACCOUNT, ['local', 'local'], 'new-transaction')
    ).toThrow('duplicates');
    expect(local.state).toBe('available');
  });

  it('releases only reservations owned by the failed transaction', () => {
    const ours = storedNote('ours', 'in_flight', 'new-transaction');
    const theirs = storedNote('theirs', 'in_flight', 'other-transaction');

    expect(
      releaseOwnedNoteReservations([ours, theirs], ACCOUNT, ['ours', 'theirs'], 'new-transaction')
    ).toBe(1);
    expect(ours.state).toBe('available');
    expect(ours.pendingTxId).toBeUndefined();
    expect(theirs).toMatchObject({ state: 'in_flight', pendingTxId: 'other-transaction' });
  });

  it('stages reservation and history together and rolls back only its own mutation', () => {
    const note = storedNote('input');
    const concurrentHistory = walletTransaction('existing', []);
    const transactions = [concurrentHistory];
    const pending = walletTransaction('new-transaction', ['input']);

    const staged = stageExactTransactionReservation(
      [note],
      transactions,
      ACCOUNT,
      ['input'],
      pending
    );
    expect(note).toMatchObject({ state: 'in_flight', pendingTxId: 'new-transaction' });
    expect(transactions.map(transaction => transaction.id)).toEqual([
      'new-transaction',
      'existing',
    ]);

    // A concurrent history append must survive rollback of the staged send.
    transactions.push(walletTransaction('concurrent', []));
    staged.rollback();
    expect(note.state).toBe('available');
    expect(note.pendingTxId).toBeUndefined();
    expect(transactions.map(transaction => transaction.id)).toEqual(['existing', 'concurrent']);
  });

  it('releases only unowned reservations confirmed to remain on chain', () => {
    const active = storedNote('active', 'in_flight', 'active-transaction');
    const missingHistory = storedNote('missing', 'in_flight', 'missing-transaction');
    const terminal = storedNote('terminal', 'in_flight', 'failed-transaction');
    const offChain = storedNote('off-chain', 'in_flight', 'missing-transaction');
    const transactions = [
      walletTransaction('active-transaction', ['active']),
      walletTransaction('failed-transaction', ['terminal'], 'failed'),
    ];

    expect(
      releaseUnownedOnChainReservations(
        [active, missingHistory, terminal, offChain],
        transactions,
        ACCOUNT,
        new Set(['active', 'missing', 'terminal'])
      )
    ).toBe(2);
    expect(active).toMatchObject({ state: 'in_flight', pendingTxId: 'active-transaction' });
    expect(missingHistory.state).toBe('available');
    expect(terminal.state).toBe('available');
    expect(offChain).toMatchObject({ state: 'in_flight', pendingTxId: 'missing-transaction' });
  });

  it('keeps reservations owned by an incomplete legacy pending record', () => {
    const note = storedNote('legacy', 'in_flight', 'legacy-transaction');
    const legacy = walletTransaction('legacy-transaction', []);

    expect(releaseUnownedOnChainReservations([note], [legacy], ACCOUNT, new Set(['legacy']))).toBe(
      0
    );
    expect(note.state).toBe('in_flight');
  });

  it('fails and releases an exact send interrupted before tx-id persistence', () => {
    const note = storedNote('input', 'in_flight', 'interrupted');
    const interrupted = {
      ...walletTransaction('interrupted', ['input']),
      exactIntentId: 'approved-intent',
    };
    const ambiguous = {
      ...walletTransaction('ambiguous', ['other']),
      exactIntentId: 'approved-intent',
      txHash: 'signed-transaction-id',
    };
    const broadcastPending = {
      ...walletTransaction('broadcast-pending', ['other'], 'broadcast_pending'),
      exactIntentId: 'approved-intent',
    };

    expect(
      recoverInterruptedExactReservations(
        [note],
        [interrupted, ambiguous, broadcastPending],
        ACCOUNT,
        123
      )
    ).toEqual({ released: 1, failed: 1 });
    expect(note.state).toBe('available');
    expect(note.pendingTxId).toBeUndefined();
    expect(interrupted).toMatchObject({ status: 'failed', updatedAt: 123 });
    expect(ambiguous.status).toBe('created');
    expect(broadcastPending.status).toBe('broadcast_pending');
  });

  it('never releases a reservation owned by a different transaction during recovery', () => {
    const note = storedNote('input', 'in_flight', 'other-owner');
    const interrupted = {
      ...walletTransaction('interrupted', ['input']),
      exactIntentId: 'approved-intent',
    };

    expect(recoverInterruptedExactReservations([note], [interrupted], ACCOUNT, 123)).toEqual({
      released: 0,
      failed: 1,
    });
    expect(note).toMatchObject({ state: 'in_flight', pendingTxId: 'other-owner' });
  });

  it('recovers an interrupted wallet-managed popup or bridge submission', () => {
    const note = storedNote('input', 'in_flight', 'managed');
    const managed = {
      ...walletTransaction('managed', ['input']),
      locallyManagedSubmission: true,
    };

    expect(recoverInterruptedExactReservations([note], [managed], ACCOUNT, 123)).toEqual({
      released: 1,
      failed: 1,
    });
    expect(note).toMatchObject({ state: 'available' });
    expect(managed).toMatchObject({ status: 'failed', updatedAt: 123 });
  });

  it('stages retry reservations and owner history together with targeted rollback', () => {
    const original = storedNote('original');
    original.state = 'in_flight';
    original.pendingTxId = 'managed';
    const additional = storedNote('additional');
    const unrelated = storedNote('unrelated', 'in_flight', 'other');
    const transaction = {
      ...walletTransaction('managed', ['original']),
      locallyManagedSubmission: true,
    };

    const staged = stageAdditionalTransactionReservation(
      [original, additional, unrelated],
      transaction,
      ACCOUNT,
      ['additional']
    );
    expect(additional).toMatchObject({ state: 'in_flight', pendingTxId: 'managed' });
    expect(transaction.inputNoteIds).toEqual(['original', 'additional']);

    staged.rollback();
    expect(additional).toMatchObject({ state: 'available' });
    expect(additional.pendingTxId).toBeUndefined();
    expect(transaction.inputNoteIds).toEqual(['original']);
    expect(unrelated).toMatchObject({ state: 'in_flight', pendingTxId: 'other' });
  });
});
