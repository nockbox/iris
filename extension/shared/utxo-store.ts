/**
 * UTXO Store - Manages local UTXO state for successive transactions
 *
 * This module is the source of truth for spendable balance.
 * It tracks note state (available, in_flight, spent) and
 * provides thread-safe operations via per-account mutexes.
 */

import { STORAGE_KEYS } from './constants';
import type {
  StoredNote,
  UTXOStore,
  NoteState,
  WalletTransaction,
  WalletTxStore,
  AccountSyncState,
  SyncStateStore,
  FetchedUTXO,
  Note,
} from './types';
import { base58 } from '@scure/base';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// ============================================================================
// Per-Account Mutex - Prevents race conditions on rapid sends
// ============================================================================

const accountLocks = new Map<string, Promise<void>>();

/**
 * Execute a function with exclusive access to an account's UTXO state
 * Prevents race conditions when building multiple transactions rapidly
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
 * Generate note ID from a Note (RPC response format)
 */
export function noteIdFromNote(note: Note): string {
  const first = note.nameFirstBase58 || base58.encode(note.nameFirst);
  const last = note.nameLastBase58 || base58.encode(note.nameLast);
  return generateNoteId(first, last);
}

/**
 * Convert Uint8Array to base58 string
 */
function uint8ArrayToBase58(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

// ============================================================================
// UTXO Store Operations
// ============================================================================

/**
 * Get the UTXO store from chrome storage
 */
async function getUTXOStore(): Promise<UTXOStore> {
  const result = (await chrome.storage.local.get([STORAGE_KEYS.UTXO_STORE])) as Record<
    string,
    unknown
  >;
  const raw = result[STORAGE_KEYS.UTXO_STORE];
  return (isRecord(raw) ? raw : {}) as UTXOStore;
}

/**
 * Save the UTXO store to chrome storage
 */
async function saveUTXOStore(store: UTXOStore): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.UTXO_STORE]: store,
  });
}

/**
 * Get all notes for an account
 */
export async function getAccountNotes(accountAddress: string): Promise<StoredNote[]> {
  const store = await getUTXOStore();
  return store[accountAddress]?.notes || [];
}

/**
 * Get only available (spendable) notes for an account
 * This is the ONLY function that should be used when selecting inputs for transactions
 */
export async function getAvailableNotes(accountAddress: string): Promise<StoredNote[]> {
  const notes = await getAccountNotes(accountAddress);
  return notes.filter(n => n.state === 'available');
}

/**
 * Get spendable balance for an account (sum of available notes)
 * This is the source of truth for what the user can spend
 */
export async function getSpendableBalance(accountAddress: string): Promise<number> {
  const available = await getAvailableNotes(accountAddress);
  return available.reduce((sum, note) => sum + note.assets, 0);
}

/**
 * Get pending outgoing balance (sum of in_flight notes)
 */
export async function getPendingOutgoingBalance(accountAddress: string): Promise<number> {
  const notes = await getAccountNotes(accountAddress);
  return notes.filter(n => n.state === 'in_flight').reduce((sum, note) => sum + note.assets, 0);
}

/**
 * Get total known balance (available + pending)
 */
export async function getTotalKnownBalance(accountAddress: string): Promise<{
  available: number;
  pending: number;
  total: number;
}> {
  const notes = await getAccountNotes(accountAddress);
  const available = notes
    .filter(n => n.state === 'available')
    .reduce((sum, n) => sum + n.assets, 0);
  const pending = notes.filter(n => n.state === 'in_flight').reduce((sum, n) => sum + n.assets, 0);

  return {
    available,
    pending,
    total: available + pending,
  };
}

/**
 * Save/update notes for an account
 * Merges with existing notes, updating state for known notes
 */
export async function saveNotes(accountAddress: string, newNotes: StoredNote[]): Promise<void> {
  const store = await getUTXOStore();

  if (!store[accountAddress]) {
    store[accountAddress] = { notes: [], version: 0 };
  }

  const existingNotes = store[accountAddress].notes;
  const existingMap = new Map(existingNotes.map(n => [n.noteId, n]));

  // Merge: new notes override existing ones
  for (const note of newNotes) {
    existingMap.set(note.noteId, note);
  }

  store[accountAddress].notes = Array.from(existingMap.values());
  store[accountAddress].version += 1;

  await saveUTXOStore(store);
}

/**
 * Mark notes as in_flight (reserved for a pending transaction)
 * Called at the START of transaction building to prevent double-spend
 */
export async function markNotesInFlight(
  accountAddress: string,
  noteIds: string[],
  walletTxId: string
): Promise<void> {
  const store = await getUTXOStore();

  if (!store[accountAddress]) {
    throw new Error(`No UTXO store for account ${accountAddress}`);
  }

  const noteIdSet = new Set(noteIds);
  let lockedCount = 0;

  for (const note of store[accountAddress].notes) {
    if (noteIdSet.has(note.noteId)) {
      if (note.state !== 'available') {
        throw new Error(
          `Cannot lock note ${note.noteId}: current state is ${note.state}, expected available`
        );
      }
      note.state = 'in_flight';
      note.pendingTxId = walletTxId;
      lockedCount++;
    }
  }

  if (lockedCount !== noteIds.length) {
    throw new Error(`Failed to lock all notes: expected ${noteIds.length}, found ${lockedCount}`);
  }

  store[accountAddress].version += 1;
  await saveUTXOStore(store);
}

/**
 * Mark notes as spent (transaction confirmed)
 * Called when sync detects the notes are no longer on-chain
 */
export async function markNotesSpent(accountAddress: string, noteIds: string[]): Promise<void> {
  const store = await getUTXOStore();

  if (!store[accountAddress]) {
    return; // Nothing to do
  }

  const noteIdSet = new Set(noteIds);

  for (const note of store[accountAddress].notes) {
    if (noteIdSet.has(note.noteId)) {
      note.state = 'spent';
      // Keep pendingTxId for reference
    }
  }

  store[accountAddress].version += 1;
  await saveUTXOStore(store);
}

/**
 * Release in_flight notes back to available (if transaction fails or expires)
 * Called when transaction building or broadcast fails
 */
export async function releaseInFlightNotes(
  accountAddress: string,
  noteIds: string[]
): Promise<void> {
  const store = await getUTXOStore();

  if (!store[accountAddress]) {
    return; // Nothing to do
  }

  const noteIdSet = new Set(noteIds);

  for (const note of store[accountAddress].notes) {
    if (noteIdSet.has(note.noteId)) {
      if (note.state === 'in_flight') {
        note.state = 'available';
        delete note.pendingTxId;
      }
    }
  }

  store[accountAddress].version += 1;
  await saveUTXOStore(store);
}

/**
 * Remove spent notes from storage (cleanup)
 * Called periodically to prevent storage bloat
 */
export async function removeSpentNotes(accountAddress: string): Promise<number> {
  const store = await getUTXOStore();

  if (!store[accountAddress]) {
    return 0;
  }

  const before = store[accountAddress].notes.length;
  store[accountAddress].notes = store[accountAddress].notes.filter(n => n.state !== 'spent');
  const removed = before - store[accountAddress].notes.length;

  if (removed > 0) {
    store[accountAddress].version += 1;
    await saveUTXOStore(store);
  }

  return removed;
}

/**
 * Clear all notes for an account (for testing/reset)
 */
export async function clearAccountNotes(accountAddress: string): Promise<void> {
  const store = await getUTXOStore();
  delete store[accountAddress];
  await saveUTXOStore(store);
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

// ============================================================================
// Sync State Operations
// ============================================================================

/**
 * Get sync state for all accounts
 */
async function getSyncStateStore(): Promise<SyncStateStore> {
  const result = (await chrome.storage.local.get([STORAGE_KEYS.ACCOUNT_SYNC_STATE])) as Record<
    string,
    unknown
  >;
  const raw = result[STORAGE_KEYS.ACCOUNT_SYNC_STATE];
  return (isRecord(raw) ? raw : {}) as SyncStateStore;
}

/**
 * Save sync state store
 */
async function saveSyncStateStore(store: SyncStateStore): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACCOUNT_SYNC_STATE]: store,
  });
}

/**
 * Get sync state for an account
 */
export async function getAccountSyncState(
  accountAddress: string
): Promise<AccountSyncState | null> {
  const store = await getSyncStateStore();
  return store[accountAddress] || null;
}

/**
 * Update sync state for an account
 */
export async function updateAccountSyncState(
  accountAddress: string,
  lastSyncedHeight: number
): Promise<void> {
  const store = await getSyncStateStore();
  store[accountAddress] = {
    accountAddress,
    lastSyncedHeight,
    lastSyncedAt: Date.now(),
  };
  await saveSyncStateStore(store);
}

// ============================================================================
// Wallet Transaction Store Operations
// ============================================================================

/**
 * Get wallet transaction store
 */
async function getWalletTxStore(): Promise<WalletTxStore> {
  const result = (await chrome.storage.local.get([STORAGE_KEYS.WALLET_TX_STORE])) as Record<
    string,
    unknown
  >;
  const raw = result[STORAGE_KEYS.WALLET_TX_STORE];
  return (isRecord(raw) ? raw : {}) as WalletTxStore;
}

/**
 * Save wallet transaction store
 */
async function saveWalletTxStore(store: WalletTxStore): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.WALLET_TX_STORE]: store,
  });
}

/**
 * Get all wallet transactions for an account
 */
export async function getWalletTransactions(accountAddress: string): Promise<WalletTransaction[]> {
  const store = await getWalletTxStore();
  return store[accountAddress] || [];
}

/**
 * Add a new wallet transaction
 */
export async function addWalletTransaction(tx: WalletTransaction): Promise<void> {
  const store = await getWalletTxStore();

  if (!store[tx.accountAddress]) {
    store[tx.accountAddress] = [];
  }

  // Check for duplicate
  const exists = store[tx.accountAddress].some(t => t.id === tx.id);
  if (exists) {
    console.warn(`[UTXO Store] Transaction ${tx.id} already exists, skipping add`);
    return;
  }

  // Add to beginning (most recent first)
  store[tx.accountAddress].unshift(tx);

  // Limit to 200 transactions per account
  if (store[tx.accountAddress].length > 200) {
    store[tx.accountAddress] = store[tx.accountAddress].slice(0, 200);
  }

  await saveWalletTxStore(store);
}

/**
 * Update a wallet transaction
 */
export async function updateWalletTransaction(
  accountAddress: string,
  txId: string,
  updates: Partial<WalletTransaction>
): Promise<void> {
  const store = await getWalletTxStore();

  if (!store[accountAddress]) {
    return;
  }

  const txIndex = store[accountAddress].findIndex(t => t.id === txId);
  if (txIndex === -1) {
    console.warn(`[UTXO Store] Transaction ${txId} not found for update`);
    return;
  }

  store[accountAddress][txIndex] = {
    ...store[accountAddress][txIndex],
    ...updates,
    updatedAt: Date.now(),
  };

  await saveWalletTxStore(store);
}

/**
 * Find a wallet transaction by its on-chain hash
 */
export async function findWalletTxByHash(
  accountAddress: string,
  txHash: string
): Promise<WalletTransaction | null> {
  const transactions = await getWalletTransactions(accountAddress);
  return transactions.find(t => t.txHash === txHash) || null;
}

/**
 * Get pending outgoing transactions (for expiry checking)
 */
export async function getPendingOutgoingTransactions(
  accountAddress: string
): Promise<WalletTransaction[]> {
  const transactions = await getWalletTransactions(accountAddress);
  return transactions.filter(
    t =>
      t.direction === 'outgoing' &&
      (t.status === 'created' ||
        t.status === 'broadcast_pending' ||
        t.status === 'broadcasted_unconfirmed')
  );
}

/**
 * Get all outgoing transactions (pending + confirmed) for change detection
 * This is needed to identify change UTXOs even after a transaction is confirmed
 */
export async function getAllOutgoingTransactions(
  accountAddress: string
): Promise<WalletTransaction[]> {
  const transactions = await getWalletTransactions(accountAddress);
  return transactions.filter(t => t.direction === 'outgoing');
}
