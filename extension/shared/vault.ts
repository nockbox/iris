/// <reference types="chrome" />
/**
 * Vault: manages encrypted mnemonic storage and wallet state
 */

import { encryptGCM, decryptGCM, deriveKeyPBKDF2, rand, PBKDF2_ITERATIONS } from './webcrypto';
import {
  generateMnemonic,
  deriveAddress,
  deriveAddressFromMaster,
  validateMnemonic,
} from './wallet-crypto';
import {
  ERROR_CODES,
  STORAGE_KEYS,
  ACCOUNT_COLORS,
  PRESET_WALLET_STYLES,
  NOCK_TO_NICKS,
} from './constants';
import { Account } from './types';
import { buildMultiNotePayment, type Note } from './transaction-builder';
import * as wasm from '@nockbox/iris-wasm/iris_wasm.js';
import { queryV1Balance } from './balance-query';
import { createBrowserClient } from './rpc-client-browser';
import type { Note as BalanceNote, UTXOStore, WalletTxStore } from './types';
import { base58 } from '@scure/base';
import { initWasmModules } from './wasm-utils';
import {
  withAccountLock,
  fetchedToStoredNote,
  noteToStoredNote,
  generateNoteId,
} from './utxo-store';
import {
  computeUTXODiff,
  classifyNewUTXO,
  findExpiredTransactions,
  areTransactionInputsSpent,
  matchChangeOutputs,
} from './utxo-diff';
import type { StoredNote, WalletTransaction, FetchedUTXO } from './types';

/**
 * Convert a balance query note to transaction builder note format
 * @param note - Note from balance query (with Uint8Array names)
 * @returns Note in format expected by transaction builder
 *
 * NOTE: Prefers pre-computed base58 values from the RPC response to avoid WASM init issues
 */
async function convertNoteForTxBuilder(note: BalanceNote, ownerPKH: string): Promise<Note> {
  // Use pre-computed base58 strings if available (from WASM gRPC client)
  let nameFirst: string;
  let nameLast: string;
  let noteDataHash: string;

  if (note.nameFirstBase58 && note.nameLastBase58) {
    nameFirst = note.nameFirstBase58;
    nameLast = note.nameLastBase58;
  } else {
    // Fallback: convert bytes to base58
    nameFirst = base58.encode(note.nameFirst);
    nameLast = base58.encode(note.nameLast);
  }

  if (note.noteDataHashBase58) {
    noteDataHash = note.noteDataHashBase58;
  } else {
    // Fallback - use protoNote for Note.fromProtobuf()
    console.warn('[Vault] No noteDataHashBase58 - relying on protoNote');
    noteDataHash = '';
  }

  return {
    originPage: Number(note.originPage),
    nameFirst,
    nameLast,
    noteDataHash,
    assets: note.assets,
    protoNote: note.protoNote,
  };
}

/**
 * Convert a stored note to transaction builder note format
 * StoredNotes already have base58 strings, so this is a simple field mapping
 * @param note - Note from UTXO store
 * @returns Note in format expected by transaction builder
 */
function convertStoredNoteForTxBuilder(note: StoredNote): Note {
  return {
    originPage: note.originPage,
    nameFirst: note.nameFirst,
    nameLast: note.nameLast,
    noteDataHash: note.noteDataHashBase58,
    assets: note.assets,
    protoNote: note.protoNote,
  };
}

/**
 * Greedy coin selection algorithm
 * Selects notes (largest first) until we have enough to cover amount + fee
 *
 * @param notes - Available notes
 * @param targetAmount - Amount needed (amount + estimated fee)
 * @returns Selected notes, or null if insufficient funds
 */
function selectNotesForAmount(notes: StoredNote[], targetAmount: number): StoredNote[] | null {
  // Sort by assets descending (largest first)
  const sorted = [...notes].sort((a, b) => b.assets - a.assets);

  const selected: StoredNote[] = [];
  let total = 0;

  for (const note of sorted) {
    selected.push(note);
    total += note.assets;

    if (total >= targetAmount) {
      return selected;
    }
  }

  // Not enough funds
  return null;
}

/**
 * Blob that stores encrypted note data
 */
interface EncryptedNotesBlob {
  version: 1;
  cipher: {
    alg: 'AES-GCM';
    iv: number[];
    ct: number[];
  };
}

/**
 * Encrypted account data - frequently changing data tied to accounts
 * Stored separately from VaultPayload (mnemonic/accounts) for efficiency
 * All fields saved atomically to prevent inconsistency
 */
interface EncryptedAccountData {
  utxoStore: UTXOStore;
  walletTxStore: WalletTxStore;
  cachedBalances: Record<string, number>; // address -> balance in nicks
}

/**
 * Encrypted vault format
 * Encrypts both mnemonic AND accounts for better privacy
 * Prevents address enumeration from disk/backup without password
 */
interface EncryptedVault {
  version: 1;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: number[]; // PBKDF2 salt for key derivation
  };
  cipher: {
    alg: 'AES-GCM';
    iv: number[]; // AES-GCM initialization vector (12 bytes)
    ct: number[]; // Ciphertext (includes authentication tag, contains VaultPayload)
  };
}

/**
 * The decrypted vault payload (mnemonic + accounts)
 * This blob rarely changes (only on account creation/modification)
 */
interface VaultPayload {
  mnemonic: string;
  accounts: Account[];
}


interface VaultState {
  locked: boolean;
  accounts: Account[];
  currentAccountIndex: number;
  enc: EncryptedVault | null;
}

export class Vault {
  private state: VaultState = {
    locked: true,
    accounts: [],
    currentAccountIndex: 0,
    enc: null,
  };

  /** Decrypted mnemonic (only stored in memory while unlocked) */
  private mnemonic: string | null = null;

  /** Derived encryption key (only stored in memory while unlocked, cleared on lock) */
  private encryptionKey: CryptoKey | null = null;

  /** Decrypted UTXO store (only stored in memory while unlocked)*/
  private utxoStore: UTXOStore = {};

  /** Decrypted wallet transactions (only stored in memory while unlocked) */
  private walletTxStore: WalletTxStore = {};

  /** Cached balances per account (only stored in memory while unlocked) */
  private cachedBalances: Record<string, number> = {};

  /**
   * Check if a vault exists in storage (without decrypting)
   * This is safe to call even after service worker restart
   * @returns true if encrypted vault exists, false if no vault setup yet
   */
  async hasVault(): Promise<boolean> {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.ENCRYPTED_VAULT]);
    return Boolean(stored[STORAGE_KEYS.ENCRYPTED_VAULT]);
  }

  /**
   * Initialize vault state from storage (load encrypted header without decrypting)
   * Call this on service worker startup or before checking vault existence
   * Safe to call multiple times (idempotent)
   */
  async init(): Promise<void> {
    // If already loaded, do nothing
    if (this.state.enc) return;

    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ENCRYPTED_VAULT,
      STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
    ]);

    const enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as EncryptedVault | undefined;
    if (enc) {
      this.state.enc = enc; // Header is safe to keep in memory
      this.state.locked = true; // Still locked
      this.state.accounts = []; // No plaintext accounts in memory
      this.state.currentAccountIndex =
        (stored[STORAGE_KEYS.CURRENT_ACCOUNT_INDEX] as number | undefined) || 0;
    } else {
      // No vault yet — keep defaults
      this.state.enc = null;
      this.state.locked = true;
    }
  }

  /**
   * Get UI status without revealing secrets
   * Safe to expose to popup for screen routing
   */
  getUiStatus(): { hasVault: boolean; locked: boolean } {
    return {
      hasVault: Boolean(this.state.enc),
      locked: this.state.locked,
    };
  }

  /**
   * Sets up a new vault with encrypted mnemonic
   * @param password - User password for encryption
   * @param mnemonic - Optional mnemonic for importing existing wallet (otherwise generates new one)
   */

  async setup(
    password: string,
    mnemonic?: string
  ): Promise<{ ok: boolean; address: string; mnemonic: string } | { error: string }> {
    // Generate or validate mnemonic
    const words = mnemonic ? mnemonic.trim() : generateMnemonic();

    // Validate imported mnemonic
    if (mnemonic && !validateMnemonic(words)) {
      return { error: ERROR_CODES.INVALID_MNEMONIC };
    }

    // Create first account (Wallet 1 at index 0)
    // Use first preset style for consistent initial experience
    const firstPreset = PRESET_WALLET_STYLES[0];

    const masterAddress = await deriveAddressFromMaster(words);

    const firstAccount: Account = {
      name: 'Wallet 1',
      address: masterAddress,
      index: 0,
      iconStyleId: firstPreset.iconStyleId,
      iconColor: firstPreset.iconColor,
      createdAt: Date.now(),
      derivation: 'master',
    };

    // Generate PBKDF2 salt and derive encryption key
    const kdfSalt = rand(16);
    const { key } = await deriveKeyPBKDF2(password, kdfSalt);

    // Encrypt mnemonic + accounts (notes are in a separate blob)
    const vaultPayload: VaultPayload = {
      mnemonic: words,
      accounts: [firstAccount],
    };
    const payloadJson = JSON.stringify(vaultPayload);
    const { iv, ct } = await encryptGCM(key, new TextEncoder().encode(payloadJson));

    // Store encrypted vault (arrays for chrome.storage compatibility)
    const encData: EncryptedVault = {
      version: 1,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: PBKDF2_ITERATIONS,
        salt: Array.from(kdfSalt), // PBKDF2 salt
      },
      cipher: {
        alg: 'AES-GCM',
        iv: Array.from(iv), // AES-GCM IV (12 bytes)
        ct: Array.from(ct), // Ciphertext + auth tag (contains VaultPayload)
      },
    };

    // Only store encrypted vault and current account index
    // Accounts are inside the encrypted vault, not in plaintext
    await chrome.storage.local.set({
      [STORAGE_KEYS.ENCRYPTED_VAULT]: encData,
      [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: 0,
    });

    // Keep wallet unlocked after setup for smooth onboarding UX
    // Auto-lock timer will handle locking after inactivity
    this.mnemonic = words;
    this.encryptionKey = key; // Cache the key for account operations (rename, create, etc.)
    this.state = {
      locked: false,
      accounts: [firstAccount],
      currentAccountIndex: 0,
      enc: encData,
    };

    return { ok: true, address: firstAccount.address, mnemonic: words };
  }

  /**
   * Unlocks the vault with the provided password
   */
  async unlock(
    password: string
  ): Promise<
    | { ok: boolean; address: string; accounts: Account[]; currentAccount: Account }
    | { error: string }
  > {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ENCRYPTED_VAULT,
      STORAGE_KEYS.ENCRYPTED_NOTES,
      STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
      STORAGE_KEYS.UTXO_STORE, // For legacy migration check
      STORAGE_KEYS.WALLET_TX_STORE, // For legacy migration check
      STORAGE_KEYS.CACHED_BALANCES, // For legacy migration check
    ]);
    // Change to let to allow reassignment if migrating
    let enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as EncryptedVault | undefined;
    const encNotes = stored[STORAGE_KEYS.ENCRYPTED_NOTES] as EncryptedNotesBlob | undefined;
    const currentAccountIndex =
      (stored[STORAGE_KEYS.CURRENT_ACCOUNT_INDEX] as number | undefined) || 0;

    if (!enc) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    try {
      // Re-derive key using stored KDF parameters (critical for forward compatibility)
      const { key } = await deriveKeyPBKDF2(
        password,
        new Uint8Array(enc.kdf.salt),
        enc.kdf.iterations,
        enc.kdf.hash
      );

      // Decrypt the vault
      const pt = await decryptGCM(
        key,
        new Uint8Array(enc.cipher.iv),
        new Uint8Array(enc.cipher.ct)
      ).catch(() => null);

      if (!pt) {
        return { error: ERROR_CODES.BAD_PASSWORD };
      }

      // Parse vault payload
      const payload = JSON.parse(pt) as VaultPayload;
      const mnemonic = payload.mnemonic;
      const accounts = payload.accounts;

      // Load account data from separate encrypted blob
      let utxoStore: UTXOStore = {};
      let walletTxStore: WalletTxStore = {};
      let cachedBalances: Record<string, number> = {};
      let loadedFromEncrypted = false;

      if (encNotes) {
        const notesPt = await decryptGCM(
          key,
          new Uint8Array(encNotes.cipher.iv),
          new Uint8Array(encNotes.cipher.ct)
        ).catch(() => null);

        if (notesPt) {
          const accountData = JSON.parse(notesPt) as EncryptedAccountData;
          utxoStore = accountData.utxoStore || {};
          walletTxStore = accountData.walletTxStore || {};
          cachedBalances = accountData.cachedBalances || {};
          loadedFromEncrypted = true;
          console.log('[Vault] Loaded account data from encrypted blob');
        }
      }

      // Migration: if no encrypted blob, check for legacy unencrypted stores
      if (!loadedFromEncrypted) {
        const legacyUtxoStore = stored[STORAGE_KEYS.UTXO_STORE] as UTXOStore | undefined;
        const legacyWalletTxStore = stored[STORAGE_KEYS.WALLET_TX_STORE] as WalletTxStore | undefined;
        const legacyCachedBalances = stored[STORAGE_KEYS.CACHED_BALANCES] as Record<string, number> | undefined;

        const hasLegacyData =
          (legacyUtxoStore && Object.keys(legacyUtxoStore).length > 0) ||
          (legacyWalletTxStore && Object.keys(legacyWalletTxStore).length > 0) ||
          (legacyCachedBalances && Object.keys(legacyCachedBalances).length > 0);

        if (hasLegacyData) {
          console.log('[Vault] Migrating legacy unencrypted stores to encrypted blob');
          utxoStore = legacyUtxoStore || {};
          walletTxStore = legacyWalletTxStore || {};
          cachedBalances = legacyCachedBalances || {};
        }
      }

      // Store decrypted data in memory
      this.mnemonic = mnemonic;
      this.encryptionKey = key;
      this.utxoStore = utxoStore;
      this.walletTxStore = walletTxStore;
      this.cachedBalances = cachedBalances;

      // Complete migration: encrypt and remove legacy stores
      if (!loadedFromEncrypted) {
        const hasData =
          Object.keys(utxoStore).length > 0 ||
          Object.keys(walletTxStore).length > 0 ||
          Object.keys(cachedBalances).length > 0;
        if (hasData) {
          await this.saveAccountData();
          await chrome.storage.local.remove([
            STORAGE_KEYS.UTXO_STORE,
            STORAGE_KEYS.WALLET_TX_STORE,
            STORAGE_KEYS.CACHED_BALANCES,
          ]);
          console.log('[Vault] Migration complete');
        }
      }

      this.state = {
        locked: false,
        accounts,
        currentAccountIndex,
        enc,
      };

      const currentAccount = accounts[currentAccountIndex] || accounts[0];
      return {
        ok: true,
        address: currentAccount?.address || '',
        accounts,
        currentAccount,
      };
    } catch (err) {
      return { error: ERROR_CODES.BAD_PASSWORD };
    }
  }

  /**
   * Helper method to save accounts back to the encrypted vault
   * Called whenever accounts are modified (create, rename, update styling, hide)
   * Requires wallet to be unlocked (encryptionKey must be in memory)
   */
  private async saveAccountsToVault(): Promise<void> {
    if (!this.mnemonic || !this.state.enc || !this.encryptionKey) {
      throw new Error('Cannot save accounts: vault is locked or not initialized');
    }

    // Re-encrypt mnemonic + accounts together with the key stored in memory
    const vaultPayload: VaultPayload = {
      mnemonic: this.mnemonic,
      accounts: this.state.accounts,
    };
    const payloadJson = JSON.stringify(vaultPayload);
    const { iv, ct } = await encryptGCM(this.encryptionKey, new TextEncoder().encode(payloadJson));

    // Update the encrypted vault with new IV and ciphertext
    const encData: EncryptedVault = {
      version: 1,
      kdf: this.state.enc.kdf, // Reuse same KDF parameters (salt, iterations)
      cipher: {
        alg: 'AES-GCM',
        iv: Array.from(iv),
        ct: Array.from(ct),
      },
    };

    // Save updated vault to storage
    await chrome.storage.local.set({
      [STORAGE_KEYS.ENCRYPTED_VAULT]: encData,
    });

    // Update in-memory state
    this.state.enc = encData;
  }

  /**
   * Locks the vault
   */
  async lock(): Promise<{ ok: boolean }> {
    this.state.locked = true;
    // Clear sensitive data from memory for security
    this.state.accounts = []; // Clear accounts to enforce "no addresses while locked"
    this.mnemonic = null;
    this.encryptionKey = null;
    this.utxoStore = {};
    this.walletTxStore = {};
    this.cachedBalances = {};
    return { ok: true };
  }

  /**
   * Resets/deletes the wallet completely (clears all data)
   */
  async reset(): Promise<{ ok: boolean }> {
    // Clear all storage
    await chrome.storage.local.clear();

    // Reset in-memory state
    this.state = {
      locked: true,
      accounts: [],
      currentAccountIndex: 0,
      enc: null,
    };
    this.mnemonic = null;
    this.encryptionKey = null; // Clear encryption key as well
    this.utxoStore = {};

    return { ok: true };
  }

  /**
   * Returns whether the vault is currently locked
   */
  isLocked(): boolean {
    return this.state.locked;
  }

  /**
   * Gets the current account
   */
  getCurrentAccount(): Account | null {
    const account = this.state.accounts[this.state.currentAccountIndex];
    return account || this.state.accounts[0] || null;
  }

  /**
   * Gets the current address (only when unlocked)
   */
  getAddress(): string {
    const account = this.getCurrentAccount();
    return account?.address || '';
  }

  /**
   * Gets all accounts
   */
  getAccounts(): Account[] {
    return this.state.accounts;
  }

  /**
   * Gets the address safely (even when locked, from storage)
   * NOTE: Accounts are encrypted, so this only works when unlocked
   * This is intentional - better privacy, addresses not accessible without password
   */
  async getAddressSafe(): Promise<string> {
    // If unlocked, return from memory
    if (this.state.accounts.length > 0) {
      const currentAccount =
        this.state.accounts[this.state.currentAccountIndex] || this.state.accounts[0];
      return currentAccount.address;
    }

    // Accounts are encrypted, cannot read while locked
    return '';
  }

  /**
   * Gets balance from the UTXO store for an account
   * Returns available balance (excludes in-flight notes)
   */
  async getBalanceFromStore(accountAddress: string): Promise<{
    available: number;
    spendableNow: number;
    pendingOut: number;
    pendingChange: number;
    total: number;
    utxoCount: number;
    availableUtxoCount: number;
  }> {
    return this.getAccountBalanceSummary(accountAddress);
  }

  // ============================================================================
  // UTXO Store Getters (read from in-memory decrypted store)
  // ============================================================================

  /**
   * Get the entire UTXO store (in-memory)
   * Requires wallet to be unlocked
   */
  getUTXOStore(): UTXOStore {
    return this.utxoStore;
  }

  /**
   * Get all notes for an account (from in-memory store)
   */
  getAccountNotes(accountAddress: string): StoredNote[] {
    return this.utxoStore[accountAddress]?.notes || [];
  }

  /**
   * Get only available (spendable) notes for an account
   */
  getAvailableNotes(accountAddress: string): StoredNote[] {
    return this.getAccountNotes(accountAddress).filter(n => n.state === 'available');
  }

  /**
   * Get spendable balance for an account (sum of available notes)
   */
  getSpendableBalance(accountAddress: string): number {
    return this.getAvailableNotes(accountAddress).reduce((sum, n) => sum + n.assets, 0);
  }

  /**
   * Get pending outgoing balance (sum of in_flight notes)
   */
  getPendingOutgoingBalance(accountAddress: string): number {
    return this.getAccountNotes(accountAddress)
      .filter(n => n.state === 'in_flight')
      .reduce((sum, n) => sum + n.assets, 0);
  }

  // ============================================================================
  // Encrypted Storage Operations
  // ============================================================================

  /**
   * Save account data (notes, transactions, balances) to encrypted storage.
   * This blob changes frequently - on every transaction and sync.
   * All data saved atomically to prevent inconsistency.
   */
  async saveAccountData(): Promise<void> {
    if (!this.encryptionKey) {
      throw new Error('Cannot save account data: vault is locked or not initialized');
    }

    const payload: EncryptedAccountData = {
      utxoStore: this.utxoStore,
      walletTxStore: this.walletTxStore,
      cachedBalances: this.cachedBalances,
    };

    const json = JSON.stringify(payload);
    const { iv, ct } = await encryptGCM(this.encryptionKey, new TextEncoder().encode(json));

    const encData: EncryptedNotesBlob = {
      version: 1,
      cipher: {
        alg: 'AES-GCM',
        iv: Array.from(iv),
        ct: Array.from(ct),
      },
    };

    await chrome.storage.local.set({ [STORAGE_KEYS.ENCRYPTED_NOTES]: encData });
  }

  // ============================================================================
  // UTXO Store Setters (auto-persist to encrypted storage)
  // ============================================================================

  /**
   * Save/merge notes for an account
   * Automatically persists to encrypted storage
   */
  async saveNotes(accountAddress: string, newNotes: StoredNote[]): Promise<void> {
    if (!this.utxoStore[accountAddress]) {
      this.utxoStore[accountAddress] = { notes: [], version: 0 };
    }

    const existingMap = new Map(
      this.utxoStore[accountAddress].notes.map(n => [n.noteId, n])
    );

    for (const note of newNotes) {
      existingMap.set(note.noteId, note);
    }

    this.utxoStore[accountAddress].notes = Array.from(existingMap.values());
    this.utxoStore[accountAddress].version += 1;

    await this.saveAccountData();
  }

  /**
   * Mark notes as in_flight (reserved for pending transaction)
   * Automatically persists to encrypted storage
   */
  async markNotesInFlight(
    accountAddress: string,
    noteIds: string[],
    walletTxId: string
  ): Promise<void> {
    if (!this.utxoStore[accountAddress]) {
      throw new Error(`No UTXO store for account ${accountAddress}`);
    }

    const noteIdSet = new Set(noteIds);
    let lockedCount = 0;

    for (const note of this.utxoStore[accountAddress].notes) {
      if (noteIdSet.has(note.noteId)) {
        if (note.state !== 'available') {
          throw new Error(`Cannot lock note ${note.noteId}: state is ${note.state}`);
        }
        note.state = 'in_flight';
        note.pendingTxId = walletTxId;
        lockedCount++;
      }
    }

    if (lockedCount !== noteIds.length) {
      throw new Error(`Failed to lock all notes: expected ${noteIds.length}, found ${lockedCount}`);
    }

    this.utxoStore[accountAddress].version += 1;

    await this.saveAccountData();
  }

  /**
   * Mark notes as spent (transaction confirmed)
   * Automatically persists to encrypted storage
   */
  async markNotesSpent(accountAddress: string, noteIds: string[]): Promise<void> {
    if (!this.utxoStore[accountAddress]) return;

    const noteIdSet = new Set(noteIds);

    for (const note of this.utxoStore[accountAddress].notes) {
      if (noteIdSet.has(note.noteId)) {
        note.state = 'spent';
      }
    }

    this.utxoStore[accountAddress].version += 1;

    await this.saveAccountData();
  }

  /**
   * Release in_flight notes back to available (on tx failure)
   * Automatically persists to encrypted storage
   */
  async releaseInFlightNotes(accountAddress: string, noteIds: string[]): Promise<void> {
    if (!this.utxoStore[accountAddress]) return;

    const noteIdSet = new Set(noteIds);

    for (const note of this.utxoStore[accountAddress].notes) {
      if (noteIdSet.has(note.noteId) && note.state === 'in_flight') {
        note.state = 'available';
        delete note.pendingTxId;
      }
    }

    this.utxoStore[accountAddress].version += 1;

    await this.saveAccountData();
  }

  /**
   * Remove spent notes (cleanup to prevent storage bloat)
   * Only removes spent notes older than maxAgeMs (default: 1 hour)
   * Automatically persists to encrypted storage
   * @returns Number of notes removed
   */
  async removeSpentNotes(accountAddress: string, maxAgeMs: number = 60 * 60 * 1000): Promise<number> {
    if (!this.utxoStore[accountAddress]) return 0;

    const cutoff = Date.now() - maxAgeMs;
    const before = this.utxoStore[accountAddress].notes.length;

    this.utxoStore[accountAddress].notes = this.utxoStore[accountAddress].notes.filter(
      n => n.state !== 'spent' || (n.discoveredAt && n.discoveredAt > cutoff)
    );

    const removed = before - this.utxoStore[accountAddress].notes.length;
    if (removed > 0) {
      this.utxoStore[accountAddress].version += 1;
      await this.saveAccountData();
    }

    return removed;
  }

  /**
   * Replace all notes for an account (full replacement, not merge)
   * Used for force resync operations
   * Automatically persists to encrypted storage
   */
  async replaceAccountNotes(accountAddress: string, notes: StoredNote[]): Promise<void> {
    if (!this.utxoStore[accountAddress]) {
      this.utxoStore[accountAddress] = { notes: [], version: 0 };
    }

    this.utxoStore[accountAddress].notes = notes;
    this.utxoStore[accountAddress].version += 1;

    await this.saveAccountData();
  }

  // ============================================================================
  // Wallet Transaction Methods (auto-persist to encrypted storage)
  // ============================================================================

  /**
   * Get all wallet transactions for an account
   */
  getWalletTransactions(accountAddress: string): WalletTransaction[] {
    return this.walletTxStore[accountAddress] || [];
  }

  /**
   * Add a new wallet transaction
   * Automatically persists to encrypted storage
   */
  async addWalletTransaction(tx: WalletTransaction): Promise<void> {
    if (!this.walletTxStore[tx.accountAddress]) {
      this.walletTxStore[tx.accountAddress] = [];
    }

    // Check for duplicate
    const exists = this.walletTxStore[tx.accountAddress].some(t => t.id === tx.id);
    if (exists) {
      console.warn(`[Vault] Transaction ${tx.id} already exists, skipping add`);
      return;
    }

    // Add to beginning (most recent first)
    this.walletTxStore[tx.accountAddress].unshift(tx);

    // Limit to 200 transactions per account
    if (this.walletTxStore[tx.accountAddress].length > 200) {
      this.walletTxStore[tx.accountAddress] = this.walletTxStore[tx.accountAddress].slice(0, 200);
    }

    await this.saveAccountData();
  }

  /**
   * Update a wallet transaction
   * Automatically persists to encrypted storage
   */
  async updateWalletTransaction(
    accountAddress: string,
    txId: string,
    updates: Partial<WalletTransaction>
  ): Promise<void> {
    if (!this.walletTxStore[accountAddress]) {
      return;
    }

    const txIndex = this.walletTxStore[accountAddress].findIndex(t => t.id === txId);
    if (txIndex === -1) {
      console.warn(`[Vault] Transaction ${txId} not found for update`);
      return;
    }

    this.walletTxStore[accountAddress][txIndex] = {
      ...this.walletTxStore[accountAddress][txIndex],
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveAccountData();
  }

  /**
   * Get pending outgoing transactions (for expiry checking)
   */
  getPendingOutgoingTransactions(accountAddress: string): WalletTransaction[] {
    const transactions = this.getWalletTransactions(accountAddress);
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
   */
  getAllOutgoingTransactions(accountAddress: string): WalletTransaction[] {
    const transactions = this.getWalletTransactions(accountAddress);
    return transactions.filter(t => t.direction === 'outgoing');
  }

  // ============================================================================
  // Cached Balance Methods (auto-persist to encrypted storage)
  // ============================================================================

  /**
   * Get cached balances for all accounts
   */
  getCachedBalances(): Record<string, number> {
    return { ...this.cachedBalances };
  }
  /**
   * Update cached balances (batch update)
   * Automatically persists to encrypted storage
   */
  async setCachedBalances(balances: Record<string, number>): Promise<void> {
    this.cachedBalances = { ...balances };
    await this.saveAccountData();
  }
  // =============================================
  // UTXO Sync Methods
  // =============================================

  /** Transaction expiry timeout: 6 hours */
  private static readonly TX_EXPIRY_MS = 6 * 60 * 60 * 1000;

  /**
   * Convert a balance query note to FetchedUTXO format for diff computation
   */
  private noteToFetchedUTXO(note: BalanceNote): FetchedUTXO {
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
   * Sync UTXOs for a single account with chain state
   * This uses the encrypted in-memory UTXO store
   *
   * @param accountAddress - Account to sync
   * @returns Summary of what changed
   */
  async syncAccountUTXOs(accountAddress: string): Promise<{
    newIncoming: number;
    newChange: number;
    spent: number;
    confirmed: number;
    expired: number;
  }> {
    if (this.state.locked) {
      throw new Error('Vault is locked');
    }

    const rpcClient = createBrowserClient();

    return withAccountLock(accountAddress, async () => {
      // 1. Fetch current UTXOs from chain
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
      const fetchedUTXOs = chainNotes.map(n => this.noteToFetchedUTXO(n));

      // 2. Get local state (from in-memory encrypted store)
      const localNotes = this.getAccountNotes(accountAddress);
      const pendingTxs = this.getPendingOutgoingTransactions(accountAddress);
      const allOutgoingTxs = this.getAllOutgoingTransactions(accountAddress);

      // 3. Compute diff (pass all outgoing txs for change detection)
      const diff = computeUTXODiff(localNotes, fetchedUTXOs, pendingTxs, allOutgoingTxs);

      // 4. Process spent notes
      if (diff.nowSpent.length > 0) {
        const spentNoteIds = diff.nowSpent.map(n => n.noteId);
        await this.markNotesSpent(accountAddress, spentNoteIds);

        // Check if any pending transactions are now confirmed
        for (const tx of pendingTxs) {
          if (areTransactionInputsSpent(tx, diff.nowSpent)) {
            // Find change outputs for this transaction
            const changeNoteIds = matchChangeOutputs(tx, diff.newUTXOs, diff.isChangeMap);

            await this.updateWalletTransaction(accountAddress, tx.id, {
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
          storedNote.pendingTxId = walletTxId;
          newChange++;
        } else {
          // Incoming transaction - create a WalletTransaction record
          const incomingTxId = crypto.randomUUID();
          const now = Date.now();

          await this.addWalletTransaction({
            id: incomingTxId,
            txHash: newUTXO.sourceHash,
            accountAddress,
            direction: 'incoming',
            createdAt: now,
            updatedAt: now,
            status: 'confirmed',
            amount: newUTXO.assets,
            receivedNoteIds: [newUTXO.noteId],
          });

          newIncoming++;
        }

        newStoredNotes.push(storedNote);
      }

      // Save new notes
      if (newStoredNotes.length > 0) {
        await this.saveNotes(accountAddress, newStoredNotes);
      }

      // 5b. Check for pending transactions whose inputs are ALREADY spent
      let confirmedFromPreviousSpent = 0;
      const stillPendingTxs = pendingTxs.filter(tx => !areTransactionInputsSpent(tx, diff.nowSpent));

      if (stillPendingTxs.length > 0) {
        const currentNotes = this.getAccountNotes(accountAddress);
        const spentNoteIds = new Set(
          currentNotes.filter(n => n.state === 'spent').map(n => n.noteId)
        );

        for (const tx of stillPendingTxs) {
          if (!tx.inputNoteIds || tx.inputNoteIds.length === 0) continue;

          const allInputsSpent = tx.inputNoteIds.every(noteId => spentNoteIds.has(noteId));

          if (allInputsSpent) {
            await this.updateWalletTransaction(accountAddress, tx.id, {
              status: 'confirmed',
            });
            confirmedFromPreviousSpent++;
          }
        }
      }

      // 6. Handle expired transactions
      const allTxs = this.getWalletTransactions(accountAddress);
      const expiredTxs = findExpiredTransactions(allTxs, Vault.TX_EXPIRY_MS);

      for (const expiredTx of expiredTxs) {
        if (expiredTx.inputNoteIds && expiredTx.inputNoteIds.length > 0) {
          await this.releaseInFlightNotes(accountAddress, expiredTx.inputNoteIds);
        }

        await this.updateWalletTransaction(accountAddress, expiredTx.id, {
          status: 'expired',
        });
      }

      // 7. Cleanup old spent notes to prevent storage bloat
      await this.removeSpentNotes(accountAddress);

      const confirmedFromNewSpent = pendingTxs.filter(tx =>
        areTransactionInputsSpent(tx, diff.nowSpent)
      ).length;

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
   * Get balance summary for an account from encrypted UTXO store
   */
  async getAccountBalanceSummary(accountAddress: string): Promise<{
    available: number;
    spendableNow: number;
    pendingOut: number;
    pendingChange: number;
    total: number;
    utxoCount: number;
    availableUtxoCount: number;
  }> {
    const notes = this.getAccountNotes(accountAddress);
    const pendingTxs = this.getPendingOutgoingTransactions(accountAddress);

    const availableNotes = notes.filter(n => n.state === 'available');
    const pendingNotes = notes.filter(n => n.state === 'in_flight');

    const availableFromNotes = availableNotes.reduce((sum, n) => sum + n.assets, 0);
    const pendingOut = pendingNotes.reduce((sum, n) => sum + n.assets, 0);

    const pendingChange = pendingTxs.reduce((sum, tx) => sum + (tx.expectedChange || 0), 0);

    const available = availableFromNotes + pendingChange;
    const spendableNow = availableFromNotes;

    return {
      available,
      spendableNow,
      pendingOut,
      pendingChange,
      total: availableFromNotes + pendingOut,
      utxoCount: notes.filter(n => n.state !== 'spent').length,
      availableUtxoCount: availableNotes.length,
    };
  }

  /**
   * Initialize UTXO store for a newly created/imported account
   * Called on first unlock to bootstrap the local store
   * NOTE: This method exists in the original implementation but is not actually used. Left for future use
   *
   * @param accountAddress - Account to initialize
   */
  async initializeAccountUTXOs(accountAddress: string): Promise<void> {
    if (this.state.locked) {
      throw new Error('Vault is locked');
    }

    const rpcClient = createBrowserClient();

    return withAccountLock(accountAddress, async () => {
      // Check if already initialized
      const existingNotes = this.getAccountNotes(accountAddress);
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

      // Save notes
      if (storedNotes.length > 0) {
        await this.saveNotes(accountAddress, storedNotes);
      }
    });
  }

  /**
   * Force a full resync of an account's UTXOs
   * Useful for recovery scenarios or user-initiated refresh
   * NOTE: Method existed in previos UTXO store implementation but not used. Left for potential future use.
   * @param accountAddress - Account to resync
   */
  async forceResyncAccount(accountAddress: string): Promise<void> {
    if (this.state.locked) {
      throw new Error('Vault is locked');
    }

    const rpcClient = createBrowserClient();

    return withAccountLock(accountAddress, async () => {
      // Fetch current UTXOs from chain
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
      const fetchedUTXOs = chainNotes.map(n => this.noteToFetchedUTXO(n));

      // Get existing notes to preserve pending state
      const existingNotes = this.getAccountNotes(accountAddress);

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
      // Note: Full replacement, not a merge - clears notes not on chain
      await this.replaceAccountNotes(accountAddress, newStoredNotes);
    });
  }

  /**
   * Creates a new account by deriving the next index
   */
  async createAccount(
    name?: string
  ): Promise<{ ok: boolean; account: Account } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    if (!this.mnemonic) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    const nextIndex = this.state.accounts.length;
    const accountName = name || `Wallet ${nextIndex + 1}`;

    // Use preset style if available, otherwise random
    let iconStyleId: number;
    let iconColor: string;

    if (nextIndex < PRESET_WALLET_STYLES.length) {
      // Use predetermined style for first 21 wallets
      const preset = PRESET_WALLET_STYLES[nextIndex];
      iconStyleId = preset.iconStyleId;
      iconColor = preset.iconColor;
    } else {
      // After presets exhausted, use random selection
      iconColor = ACCOUNT_COLORS[Math.floor(Math.random() * ACCOUNT_COLORS.length)];
      iconStyleId = Math.floor(Math.random() * 15) + 1;
    }

    const newAccount: Account = {
      name: accountName,
      address: await deriveAddress(this.mnemonic, nextIndex),
      index: nextIndex,
      iconStyleId,
      iconColor,
      createdAt: Date.now(),
      derivation: 'slip10', // Additional accounts use child derivation
    };

    const updatedAccounts = [...this.state.accounts, newAccount];
    this.state.accounts = updatedAccounts;

    // Save accounts to encrypted vault
    await this.saveAccountsToVault();

    return { ok: true, account: newAccount };
  }

  /**
   * Switches to a different account
   */
  async switchAccount(
    index: number
  ): Promise<{ ok: boolean; account: Account } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    if (index < 0 || index >= this.state.accounts.length) {
      return { error: ERROR_CODES.INVALID_ACCOUNT_INDEX };
    }

    this.state.currentAccountIndex = index;

    await chrome.storage.local.set({
      [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: index,
    });

    return { ok: true, account: this.state.accounts[index] };
  }

  /**
   * Renames an account
   */
  async renameAccount(index: number, name: string): Promise<{ ok: boolean } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    if (index < 0 || index >= this.state.accounts.length) {
      return { error: ERROR_CODES.INVALID_ACCOUNT_INDEX };
    }

    this.state.accounts[index].name = name;

    // Save accounts to encrypted vault
    await this.saveAccountsToVault();

    return { ok: true };
  }

  /**
   * Updates account styling (icon and color)
   */
  async updateAccountStyling(
    index: number,
    iconStyleId: number,
    iconColor: string
  ): Promise<{ ok: boolean } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    if (index < 0 || index >= this.state.accounts.length) {
      return { error: ERROR_CODES.INVALID_ACCOUNT_INDEX };
    }

    this.state.accounts[index].iconStyleId = iconStyleId;
    this.state.accounts[index].iconColor = iconColor;

    // Save accounts to encrypted vault
    await this.saveAccountsToVault();

    return { ok: true };
  }

  /**
   * Hides an account from the UI
   * - Auto-switches to first visible account if hiding current account
   * - Prevents hiding if it's the last visible account
   */
  async hideAccount(
    index: number
  ): Promise<{ ok: boolean; switchedTo?: number } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    if (index < 0 || index >= this.state.accounts.length) {
      return { error: ERROR_CODES.INVALID_ACCOUNT_INDEX };
    }

    // Check if this is the last visible account
    const visibleAccounts = this.state.accounts.filter(acc => !acc.hidden);
    if (visibleAccounts.length <= 1) {
      return { error: ERROR_CODES.CANNOT_HIDE_LAST_ACCOUNT };
    }

    // Mark account as hidden
    this.state.accounts[index].hidden = true;

    let switchedTo: number | undefined;

    // If hiding the current account, switch to first visible account
    if (this.state.currentAccountIndex === index) {
      const firstVisibleIndex = this.state.accounts.findIndex(acc => !acc.hidden);
      if (firstVisibleIndex !== -1) {
        this.state.currentAccountIndex = firstVisibleIndex;
        switchedTo = firstVisibleIndex;
        await chrome.storage.local.set({
          [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: firstVisibleIndex,
        });
      }
    }

    // Save accounts to encrypted vault
    await this.saveAccountsToVault();

    return { ok: true, switchedTo };
  }

  /**
   * Gets the mnemonic phrase (only when unlocked)
   * Requires password verification for security
   */
  async getMnemonic(
    password: string
  ): Promise<{ ok: boolean; mnemonic: string } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    if (!this.state.enc) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    // Re-verify password before revealing mnemonic
    try {
      const { key } = await deriveKeyPBKDF2(
        password,
        new Uint8Array(this.state.enc.kdf.salt),
        this.state.enc.kdf.iterations,
        this.state.enc.kdf.hash
      );

      const pt = await decryptGCM(
        key,
        new Uint8Array(this.state.enc.cipher.iv),
        new Uint8Array(this.state.enc.cipher.ct)
      ).catch(() => null);

      if (!pt) {
        return { error: ERROR_CODES.BAD_PASSWORD };
      }

      // Parse the vault payload and return only the mnemonic
      const payload = JSON.parse(pt) as VaultPayload;
      return { ok: true, mnemonic: payload.mnemonic };
    } catch (err) {
      return { error: ERROR_CODES.BAD_PASSWORD };
    }
  }

  /**
   * Signs a message using Nockchain WASM cryptography
   * Derives the account's private key and signs the message digest
   * @returns Object containing signature JSON and public key (hex-encoded)
   */
  async signMessage(params: unknown): Promise<{ signature: string; publicKeyHex: string }> {
    if (this.state.locked || !this.mnemonic) {
      throw new Error('Wallet is locked');
    }

    // Initialize WASM modules
    await initWasmModules();

    const msg = (Array.isArray(params) ? params[0] : params) ?? '';
    const msgString = String(msg);

    // Derive the account's private key based on derivation method
    const masterKey = wasm.deriveMasterKeyFromMnemonic(this.mnemonic, '');
    const currentAccount = this.getCurrentAccount();
    // Use the account's own index, not currentAccountIndex (accounts may be reordered)
    const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
    const accountKey =
      currentAccount?.derivation === 'master'
        ? masterKey // Use master key directly for master-derived accounts
        : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

    if (!accountKey.privateKey || !accountKey.publicKey) {
      if (currentAccount?.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Cannot sign: no private key available');
    }

    // Sign the message
    const signature = wasm.signMessage(accountKey.privateKey, msgString);

    // Convert signature to JSON format
    const signatureJson = JSON.stringify({
      c: Array.from(signature.c),
      s: Array.from(signature.s),
    });

    // Convert public key to hex string for easy transport
    const publicKeyHex = Array.from(accountKey.publicKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Clean up WASM memory
    signature.free();
    if (currentAccount?.derivation !== 'master') {
      accountKey.free();
    }
    masterKey.free();

    // Return the signature JSON and public key
    return {
      signature: signatureJson,
      publicKeyHex,
    };
  }

  /**
   * Signs a V1 transaction using Nockchain WASM cryptography
   * Derives the account's private key and builds/signs the transaction
   *
   * @param to - Recipient PKH address (base58-encoded digest string)
   * @param amount - Amount in nicks
   * @param fee - Transaction fee in nicks
   * @returns Transaction ID as digest string
   */
  async signTransaction(to: string, amount: number, fee?: number): Promise<string> {
    if (this.state.locked || !this.mnemonic) {
      throw new Error('Wallet is locked');
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      throw new Error('No account selected');
    }

    // Initialize WASM modules
    await initWasmModules();

    // Derive the account's private and public keys based on derivation method
    const masterKey = wasm.deriveMasterKeyFromMnemonic(this.mnemonic, '');
    // Use the account's own index, not currentAccountIndex (accounts may be reordered)
    const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
    const accountKey =
      currentAccount.derivation === 'master'
        ? masterKey // Use master key directly for master-derived accounts
        : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

    if (!accountKey.privateKey || !accountKey.publicKey) {
      if (currentAccount.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Cannot sign: keys unavailable');
    }

    try {
      // Create RPC client
      const rpcClient = createBrowserClient();
      const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

      if (balanceResult.utxoCount === 0) {
        throw new Error('No UTXOs available. Your wallet may have zero balance.');
      }

      // Combine simple and coinbase notes
      const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

      // Convert ALL notes to transaction builder format
      // WASM will automatically select the minimum number needed
      const txBuilderNotes = await Promise.all(
        notes.map(note => convertNoteForTxBuilder(note, currentAccount.address))
      );

      // Build and sign the transaction
      // WASM will automatically select the minimum number of notes needed
      const constructedTx = await buildMultiNotePayment(
        txBuilderNotes,
        to,
        amount,
        accountKey.publicKey,
        accountKey.privateKey,
        fee
      );

      // Return constructed transaction (for caller to broadcast)
      return constructedTx.txId;
    } finally {
      // Clean up WASM memory (don't double-free master key)
      if (currentAccount.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
    }
  }

  /**
   * Estimate transaction fee by building (but not broadcasting) a tx via WASM
   * Uses the same path as real sends (buildMultiNotePayment) so it's SW-safe
   *
   * @param to - Recipient PKH address (base58-encoded)
   * @param amount - Amount in nicks
   * @returns Estimated fee in nicks, or { error } if estimation fails
   */
  async estimateTransactionFee(
    to: string,
    amount: number
  ): Promise<{ fee: number } | { error: string }> {
    if (this.state.locked || !this.mnemonic) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }

    try {
      // Initialize WASM modules (same as sign/send)
      await initWasmModules();

      // Derive keys
      const masterKey = wasm.deriveMasterKeyFromMnemonic(this.mnemonic, '');
      const childIndex = currentAccount.index ?? this.state.currentAccountIndex;
      const accountKey =
        currentAccount.derivation === 'master' ? masterKey : masterKey.deriveChild(childIndex);

      if (!accountKey.privateKey || !accountKey.publicKey) {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
        return { error: 'Cannot estimate fee: keys unavailable' };
      }

      try {
        const rpcClient = createBrowserClient();
        const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

        if (balanceResult.utxoCount === 0) {
          return { error: 'No UTXOs available. Your wallet may have zero balance.' };
        }

        const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

        // Sort UTXOs largest to smallest (WASM will select which ones to use)
        const sortedNotes = [...notes].sort((a, b) => b.assets - a.assets);

        // Convert ALL notes to transaction builder format
        // WASM will automatically select the optimal inputs
        const txBuilderNotes = await Promise.all(
          sortedNotes.map(note => convertNoteForTxBuilder(note, currentAccount.address))
        );

        // Build a tx with fee = undefined → WASM auto-calculates using DEFAULT_FEE_PER_WORD
        // The builder calculates the exact fee needed
        const constructedTx = await buildMultiNotePayment(
          txBuilderNotes,
          to,
          amount,
          accountKey.publicKey,
          accountKey.privateKey,
          undefined // let WASM auto-calc
        );

        // Get the calculated fee from the builder
        return { fee: constructedTx.feeUsed };
      } finally {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
      }
    } catch (error) {
      console.error('[Vault] Fee estimation failed:', error);
      return {
        error: 'Fee estimation failed: ' + (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  /**
   * Estimate the maximum amount that can be sent (for "send max" feature)
   *
   * This calculates: maxAmount = totalSpendableBalance - fee
   * Where fee is calculated for a sweep transaction (all UTXOs → 1 output)
   *
   * Uses refundPKH = recipientPKH so WASM creates 1 consolidated output,
   * giving us the exact fee for a sweep transaction.
   *
   * @param to - Recipient PKH address (base58-encoded)
   * @returns Max sendable amount and fee in nicks, or { error }
   */
  async estimateMaxSendAmount(
    to: string
  ): Promise<
    | { maxAmount: number; fee: number; totalAvailable: number; utxoCount: number }
    | { error: string }
  > {
    if (this.state.locked || !this.mnemonic) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }

    try {
      // Initialize WASM modules
      await initWasmModules();

      // Derive keys
      const masterKey = wasm.deriveMasterKeyFromMnemonic(this.mnemonic, '');
      const childIndex = currentAccount.index ?? this.state.currentAccountIndex;
      const accountKey =
        currentAccount.derivation === 'master' ? masterKey : masterKey.deriveChild(childIndex);

      if (!accountKey.privateKey || !accountKey.publicKey) {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
        return { error: 'Cannot estimate max: keys unavailable' };
      }

      try {
        // Get available (not in-flight) notes from in-memory UTXO store
        const notes = this.getAvailableNotes(currentAccount.address);

        if (notes.length === 0) {
          return { error: 'No spendable UTXOs available.' };
        }

        const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);

        // Convert stored notes to transaction builder format
        const txBuilderNotes = notes.map(convertStoredNoteForTxBuilder);

        // Build a sweep transaction to get exact fee:
        // - Set refundPKH = recipientPKH (sweep mode: 1 consolidated output)
        // - WASM's simpleSpend selects minimum notes needed for the amount
        // - To force ALL notes to be used, pass an amount that REQUIRES all notes
        // - We pass (totalAvailable - smallestNote/2) so removing any note would be insufficient
        const sortedByValue = [...notes].sort((a, b) => a.assets - b.assets);
        const smallestNote = sortedByValue[0].assets;
        // Amount that requires all notes: total minus half the smallest note
        // This ensures WASM cannot satisfy the amount without using every note
        const estimationAmount = totalAvailable - Math.floor(smallestNote / 2);

        if (estimationAmount <= 0) {
          return { error: 'Balance too low to send. Need more than fee amount.' };
        }

        const constructedTx = await buildMultiNotePayment(
          txBuilderNotes,
          to,
          estimationAmount,
          accountKey.publicKey,
          accountKey.privateKey,
          undefined, // let WASM auto-calc fee
          to // refundPKH = recipient (sweep mode)
        );

        const fee = constructedTx.feeUsed;
        const maxAmount = totalAvailable - fee;

        if (maxAmount <= 0) {
          return { error: 'Balance too low. Fee would exceed available funds.' };
        }

        return {
          maxAmount,
          fee,
          totalAvailable,
          utxoCount: notes.length,
        };
      } finally {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
      }
    } catch (error) {
      console.error('[Vault] Max send estimation failed:', error);
      return {
        error:
          'Max send estimation failed: ' + (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  /**
   * Send a transaction to the network
   * This is the high-level API for sending NOCK to a recipient
   *
   * @param to - Recipient PKH address (base58-encoded digest string)
   * @param amount - Amount in nicks
   * @param fee - Transaction fee in nicks
   * @returns Transaction ID and broadcast status
   */
  async sendTransaction(
    to: string,
    amount: number,
    fee?: number
  ): Promise<{ txId: string; broadcasted: boolean; protobufTx?: any } | { error: string }> {
    if (this.state.locked || !this.mnemonic) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }

    try {
      // Initialize WASM modules
      await initWasmModules();

      // Derive the account's private and public keys based on derivation method
      const masterKey = wasm.deriveMasterKeyFromMnemonic(this.mnemonic, '');
      // Use the account's own index, not currentAccountIndex (accounts may be reordered)
      const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
      const accountKey =
        currentAccount.derivation === 'master'
          ? masterKey // Use master key directly for master-derived accounts
          : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

      if (!accountKey.privateKey || !accountKey.publicKey) {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
        return { error: 'Keys unavailable' };
      }

      try {
        // Create RPC client
        const rpcClient = createBrowserClient();
        const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

        if (balanceResult.utxoCount === 0) {
          return { error: 'No UTXOs available. Your wallet may have zero balance.' };
        }

        // Combine simple and coinbase notes
        const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
        const sortedNotes = [...notes].sort((a, b) => b.assets - a.assets);

        // Convert ALL notes to transaction builder format
        // WASM will automatically select the optimal inputs
        const txBuilderNotes = await Promise.all(
          sortedNotes.map(note => convertNoteForTxBuilder(note, currentAccount.address))
        );

        // Build and sign the transaction
        // WASM will automatically select the minimum number of notes needed
        const constructedTx = await buildMultiNotePayment(
          txBuilderNotes,
          to,
          amount,
          accountKey.publicKey,
          accountKey.privateKey,
          fee
        );

        // Convert to protobuf format for gRPC and broadcast
        const protobufTx = constructedTx.nockchainTx.toRawTx().toProtobuf();
        await rpcClient.sendTransaction(protobufTx);

        return {
          txId: constructedTx.txId,
          broadcasted: true,
          protobufTx, // Include protobuf for debugging/export
        };
      } finally {
        // Clean up WASM memory
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
      }
    } catch (error) {
      console.error('[Vault] Error sending transaction:', error);
      return {
        error: `Failed to send transaction: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Build, sign, and broadcast a transaction using UTXO store
   * This is the new preferred method for sending transactions
   *
   * Uses the account mutex to prevent race conditions on rapid sends.
   * Locks notes before building and releases them on failure.
   *
   * @param to - Recipient PKH address
   * @param amount - Amount in nicks
   * @param fee - Fee in nicks (optional, WASM will calculate if not provided)
   * @param sendMax - If true, sweep all available UTXOs to recipient (no change back)
   * @param priceUsdAtTime - USD price per NOCK at time of transaction (for historical display)
   * @returns Transaction result with txId and wallet transaction record
   */
  async sendTransactionV2(
    to: string,
    amount: number,
    fee?: number,
    sendMax?: boolean,
    priceUsdAtTime?: number
  ): Promise<
    { txId: string; walletTx: WalletTransaction; broadcasted: boolean } | { error: string }
  > {
    if (this.state.locked || !this.mnemonic) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }

    // Use account lock to prevent race conditions
    return withAccountLock(currentAccount.address, async () => {
      // Generate wallet transaction ID upfront
      const walletTxId = crypto.randomUUID();
      let selectedNoteIds: string[] = [];

      try {
        // Initialize WASM modules
        await initWasmModules();

        // Derive keys
        const masterKey = wasm.deriveMasterKeyFromMnemonic(this.mnemonic!, '');
        const childIndex = currentAccount.index ?? this.state.currentAccountIndex;
        const accountKey =
          currentAccount.derivation === 'master' ? masterKey : masterKey.deriveChild(childIndex);

        if (!accountKey.privateKey || !accountKey.publicKey) {
          if (currentAccount.derivation !== 'master') {
            accountKey.free();
          }
          masterKey.free();
          return { error: 'Keys unavailable' };
        }

        try {
          // 1. Get available notes from in-memory UTXO store (for state tracking)
          const availableStoredNotes = this.getAvailableNotes(currentAccount.address);

          if (availableStoredNotes.length === 0) {
            return { error: 'No available UTXOs.' };
          }

          const totalAvailable = availableStoredNotes.reduce((sum, n) => sum + n.assets, 0);

          // 2. Estimate fee if not provided (rough estimate: 2 NOCK should cover most cases)
          const estimatedFee = fee ?? 2 * NOCK_TO_NICKS;

          let selectedStoredNotes: typeof availableStoredNotes;
          let expectedChange: number;

          if (sendMax) {
            // SEND MAX: Use ALL available UTXOs, no change back to sender
            selectedStoredNotes = availableStoredNotes;
            expectedChange = 0; // All goes to recipient (minus fee)
          } else {
            // NORMAL: Select only notes needed for amount + fee
            const targetAmount = amount + estimatedFee;
            const selected = selectNotesForAmount(availableStoredNotes, targetAmount);

            if (!selected) {
              return {
                error: `Insufficient available funds`,
              };
            }

            selectedStoredNotes = selected;
            const selectedTotal = selectedStoredNotes.reduce((sum, n) => sum + n.assets, 0);
            expectedChange = selectedTotal - amount - estimatedFee;
          }

          selectedNoteIds = selectedStoredNotes.map(n => n.noteId);
          const selectedTotal = selectedStoredNotes.reduce((sum, n) => sum + n.assets, 0);

          // 4. Mark notes as in_flight BEFORE building transaction
          await this.markNotesInFlight(currentAccount.address, selectedNoteIds, walletTxId);

          // 5. Create wallet transaction record (status: created)
          const walletTx: WalletTransaction = {
            id: walletTxId,
            accountAddress: currentAccount.address,
            direction: 'outgoing',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            priceUsdAtTime,
            status: 'created',
            inputNoteIds: selectedNoteIds,
            recipient: to,
            amount,
            fee: estimatedFee,
            expectedChange: expectedChange > 0 ? expectedChange : 0,
          };
          await this.addWalletTransaction(walletTx);

          // 6. Convert stored notes to transaction builder format
          const sortedStoredNotes = [...selectedStoredNotes].sort((a, b) => b.assets - a.assets);
          const txBuilderNotes = sortedStoredNotes.map(convertStoredNoteForTxBuilder);

          const rpcClient = createBrowserClient();

          // For sendMax: set refundPKH = recipient so all funds go to recipient (sweep)
          const refundAddress = sendMax ? to : undefined;

          const constructedTx = await buildMultiNotePayment(
            txBuilderNotes,
            to,
            amount,
            accountKey.publicKey,
            accountKey.privateKey,
            fee,
            refundAddress
          );

          // 7. Broadcast transaction
          const protobufTx = constructedTx.nockchainTx.toRawTx().toProtobuf();
          await rpcClient.sendTransaction(protobufTx);

          // 8. Update tx status to broadcasted
          walletTx.fee = constructedTx.feeUsed;
          walletTx.txHash = constructedTx.txId;
          walletTx.status = 'broadcasted_unconfirmed';
          await this.updateWalletTransaction(currentAccount.address, walletTxId, {
            fee: constructedTx.feeUsed,
            txHash: constructedTx.txId,
            status: 'broadcasted_unconfirmed',
          });

          return {
            txId: constructedTx.txId,
            walletTx,
            broadcasted: true,
          };
        } finally {
          // Clean up WASM memory
          if (currentAccount.derivation !== 'master') {
            accountKey.free();
          }
          masterKey.free();
        }
      } catch (error) {
        console.error('[Vault V2] Transaction failed:', error);

        // Release in_flight notes on failure
        // Using in-memory method + immediate persist (restore spendability)
        if (selectedNoteIds.length > 0) {
          try {
            await this.releaseInFlightNotes(currentAccount.address, selectedNoteIds);
            await this.updateWalletTransaction(currentAccount.address, walletTxId, {
              status: 'failed',
            });
          } catch (releaseError) {
            console.error('[Vault V2] Error releasing notes:', releaseError);
          }
        }

        return {
          error: `Transaction failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });
  }

  /**
   * Sign a raw transaction using iris-wasm
   *
   * @param params - Transaction parameters with raw tx jam and notes/spend conditions
   * @returns Hex-encoded signed transaction jam
   */
  async signRawTx(params: {
    rawTx: any; // Protobuf wasm.RawTx object
    notes: any[]; // Protobuf Note objects
    spendConditions: any[]; // Protobuf SpendCondition objects
  }): Promise<any> {
    // Returns protobuf wasm.RawTx
    if (this.state.locked || !this.mnemonic) {
      throw new Error('Wallet is locked');
    }

    // Initialize WASM modules
    await initWasmModules();

    const { rawTx, notes, spendConditions } = params;

    // Derive the account's private key
    const masterKey = wasm.deriveMasterKeyFromMnemonic(this.mnemonic, '');
    const currentAccount = this.getCurrentAccount();
    const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
    const accountKey =
      currentAccount?.derivation === 'master' ? masterKey : masterKey.deriveChild(childIndex);

    if (!accountKey.privateKey) {
      if (currentAccount?.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Cannot sign: no private key available');
    }

    try {
      // Deserialize wasm.RawTx from protobuf (notes and spend conditions come as protobuf)
      const irisRawTx = wasm.RawTx.fromProtobuf(rawTx);

      // Notes are already in protobuf format from the SDK
      const irisNotes = notes.map(n => wasm.Note.fromProtobuf(n));

      // SpendConditions are in protobuf format
      const irisSpendConditions = spendConditions.map(sc => wasm.SpendCondition.fromProtobuf(sc));

      // Reconstruct the transaction builder
      const builder = wasm.TxBuilder.fromTx(irisRawTx, irisNotes, irisSpendConditions);

      // Sign
      builder.sign(accountKey.privateKey);

      // Build signed tx (returns NockchainTx)
      const signedTx = builder.build();

      // Convert to protobuf for return
      const protobuf = signedTx.toRawTx().toProtobuf();

      return protobuf;
    } finally {
      if (currentAccount?.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
    }
  }

  async computeOutputs(rawTx: any): Promise<any[]> {
    if (this.state.locked || !this.mnemonic) {
      throw new Error('Wallet is locked');
    }

    // Initialize WASM modules
    await initWasmModules();

    try {
      const irisRawTx = wasm.RawTx.fromProtobuf(rawTx);
      const outputs = irisRawTx.outputs();
      return outputs.map((output: wasm.Note) => output.toProtobuf());
    } catch (err) {
      console.error('Failed to compute outputs:', err);
      throw err;
    }
  }
}
