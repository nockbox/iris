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
import wasm from './sdk-wasm.js';
import { queryV1Balance } from './balance-query';
import { createBrowserClient } from './rpc-client-browser';
import { getEffectiveRpcEndpoint } from './rpc-config';
import type {
  Note as BalanceNote,
  UTXOStore,
  WalletTxStore,
  SyncStateStore,
  AccountSyncState,
} from './types';
import { base58 } from '@scure/base';
import { initWasmModules } from './wasm-utils';
import {
  withAccountLock,
  fetchedToStoredNote,
  noteToStoredNote,
  generateNoteId,
} from './utxo-utils';
import {
  computeUTXODiff,
  classifyNewUTXO,
  findFailedTransactions,
  findExpiredTransactions,
  areTransactionInputsSpent,
  matchChangeOutputs,
} from './utxo-diff';
import type { StoredNote, WalletTransaction, FetchedUTXO } from './types';
import type { Nicks } from './currency';
import {
  assertNativeRawTx,
  assertNativeNote,
  assertNativeSpendCondition,
} from './sign-raw-tx-compat';
import { getTxEngineSettingsForHeight } from './rpc-config';
import { getBothFirstNames } from './first-name-derivation';
import {
  createNockblocksClient,
  isNockblocksConfigured,
  type NockblocksOutput,
  type NockblocksSpend,
  type NockblocksTransaction,
} from './nockblocks-client.js';

async function txEngineSettings(blockHeight: number): Promise<wasm.TxEngineSettings> {
  return getTxEngineSettingsForHeight(blockHeight);
}

function nockchainTxToProtobuf(tx: wasm.NockchainTx): any {
  const rawTx = wasm.nockchainTxToRawTx(tx);
  return wasm.rawTxToProtobuf(rawTx);
}

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
/**
 * Encrypted account data blob format
 * Stores the encrypted form of EncryptedAccountData (notes, transactions, balances)
 */
interface EncryptedAccountDataBlob {
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
  accountSyncState: SyncStateStore;
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

  /** Per-account sync metadata for history and polling */
  private accountSyncState: SyncStateStore = {};

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
      STORAGE_KEYS.ENCRYPTED_ACCOUNT_DATA,
      STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
      STORAGE_KEYS.UTXO_STORE, // For legacy migration check
      STORAGE_KEYS.WALLET_TX_STORE, // For legacy migration check
      STORAGE_KEYS.CACHED_BALANCES, // For legacy migration check
    ]);
    // Change to let to allow reassignment if migrating
    let enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as EncryptedVault | undefined;
    const encAccountData = stored[STORAGE_KEYS.ENCRYPTED_ACCOUNT_DATA] as
      | EncryptedAccountDataBlob
      | undefined;
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
      let accountSyncState: SyncStateStore = {};
      let loadedFromEncrypted = false;

      if (encAccountData) {
        const accountDataPt = await decryptGCM(
          key,
          new Uint8Array(encAccountData.cipher.iv),
          new Uint8Array(encAccountData.cipher.ct)
        ).catch(() => null);

        if (accountDataPt) {
          const accountData = JSON.parse(accountDataPt) as EncryptedAccountData;
          utxoStore = accountData.utxoStore || {};
          for (const key in utxoStore) {
            // 0, null, undefined
            if (utxoStore[key].blockHeight == null) {
              console.log('[Vault] Clearing old UTXO store with no blockHeight');
              delete utxoStore[key];
            }
          }
          walletTxStore = accountData.walletTxStore || {};
          accountSyncState = accountData.accountSyncState || {};
          cachedBalances = accountData.cachedBalances || {};
          loadedFromEncrypted = true;
          console.log('[Vault] Loaded account data from encrypted blob');
        }
      }

      // Migration: if no encrypted blob, check for legacy unencrypted stores
      if (!loadedFromEncrypted) {
        const legacyUtxoStore = stored[STORAGE_KEYS.UTXO_STORE] as UTXOStore | undefined;
        const legacyWalletTxStore = stored[STORAGE_KEYS.WALLET_TX_STORE] as
          | WalletTxStore
          | undefined;
        const legacyCachedBalances = stored[STORAGE_KEYS.CACHED_BALANCES] as
          | Record<string, number>
          | undefined;

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
      this.accountSyncState = accountSyncState;
      this.cachedBalances = cachedBalances;

      // Complete migration: encrypt and remove legacy stores
      if (!loadedFromEncrypted) {
        const hasData =
          Object.keys(utxoStore).length > 0 ||
          Object.keys(walletTxStore).length > 0 ||
          Object.keys(cachedBalances).length > 0 ||
          Object.keys(accountSyncState).length > 0;
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
   * Unlocks the vault using a cached encryption key (used for session restore)
   */
  async unlockWithKey(
    key: CryptoKey
  ): Promise<
    | { ok: boolean; address: string; accounts: Account[]; currentAccount: Account }
    | { error: string }
  > {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ENCRYPTED_VAULT,
      STORAGE_KEYS.ENCRYPTED_ACCOUNT_DATA,
      STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
    ]);
    const enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as EncryptedVault | undefined;
    const encAccountData = stored[STORAGE_KEYS.ENCRYPTED_ACCOUNT_DATA] as
      | EncryptedAccountDataBlob
      | undefined;
    const currentAccountIndex =
      (stored[STORAGE_KEYS.CURRENT_ACCOUNT_INDEX] as number | undefined) || 0;

    if (!enc) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    const pt = await decryptGCM(
      key,
      new Uint8Array(enc.cipher.iv),
      new Uint8Array(enc.cipher.ct)
    ).catch(() => null);

    if (!pt) {
      return { error: ERROR_CODES.BAD_PASSWORD };
    }

    const payload = JSON.parse(pt) as VaultPayload;
    const accounts = payload.accounts;

    // Load account data (same as password unlock) so transaction history displays
    let utxoStore: UTXOStore = {};
    let walletTxStore: WalletTxStore = {};
    let cachedBalances: Record<string, number> = {};
    let accountSyncState: SyncStateStore = {};
    let loadedFromEncrypted = false;

    if (encAccountData) {
      const accountDataPt = await decryptGCM(
        key,
        new Uint8Array(encAccountData.cipher.iv),
        new Uint8Array(encAccountData.cipher.ct)
      ).catch(() => null);

      if (accountDataPt) {
        const accountData = JSON.parse(accountDataPt) as EncryptedAccountData;
        utxoStore = accountData.utxoStore || {};
        walletTxStore = accountData.walletTxStore || {};
        accountSyncState = accountData.accountSyncState || {};
        cachedBalances = accountData.cachedBalances || {};
        loadedFromEncrypted = true;
      }
    }

    // Key is only cached after unlock() runs, so migration has always happened.
    // No legacy fallback needed.
    this.mnemonic = payload.mnemonic;
    this.encryptionKey = key;
    this.utxoStore = utxoStore;
    this.walletTxStore = walletTxStore;
    this.accountSyncState = accountSyncState;
    this.cachedBalances = cachedBalances;

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
  }

  /**
   * Returns the cached encryption key (null when locked)
   */
  getEncryptionKey(): CryptoKey | null {
    return this.encryptionKey;
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
    this.accountSyncState = {};
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
    this.walletTxStore = {};
    this.accountSyncState = {};
    this.cachedBalances = {};

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
   * Get the last block height from the in-memory store
   */
  getAccountBlockHeight(accountAddress: string): number {
    return this.utxoStore[accountAddress]?.blockHeight || 0;
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
      accountSyncState: this.accountSyncState,
      cachedBalances: this.cachedBalances,
    };

    const json = JSON.stringify(payload);
    const { iv, ct } = await encryptGCM(this.encryptionKey, new TextEncoder().encode(json));

    const encData: EncryptedAccountDataBlob = {
      version: 1,
      cipher: {
        alg: 'AES-GCM',
        iv: Array.from(iv),
        ct: Array.from(ct),
      },
    };

    await chrome.storage.local.set({ [STORAGE_KEYS.ENCRYPTED_ACCOUNT_DATA]: encData });
  }

  // ============================================================================
  // UTXO Store Setters (auto-persist to encrypted storage)
  // ============================================================================

  /**
   * Save/merge notes for an account
   * Automatically persists to encrypted storage
   */
  async saveNotes(
    accountAddress: string,
    newNotes: StoredNote[],
    blockHeight: number
  ): Promise<void> {
    if (!this.utxoStore[accountAddress]) {
      this.utxoStore[accountAddress] = { notes: [], version: 0, blockHeight: 0 };
    }

    const existingMap = new Map(this.utxoStore[accountAddress].notes.map(n => [n.noteId, n]));

    for (const note of newNotes) {
      existingMap.set(note.noteId, note);
    }

    this.utxoStore[accountAddress].notes = Array.from(existingMap.values());
    this.utxoStore[accountAddress].version += 1;
    this.utxoStore[accountAddress].blockHeight = blockHeight;
    this.accountSyncState[accountAddress] = {
      ...this.getAccountSyncState(accountAddress),
      accountAddress,
      lastSyncedHeight: Math.max(this.getAccountSyncState(accountAddress).lastSyncedHeight, blockHeight),
      lastSyncedAt: Date.now(),
    };

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
  async removeSpentNotes(
    accountAddress: string,
    maxAgeMs: number = 60 * 60 * 1000
  ): Promise<number> {
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
  async replaceAccountNotes(
    accountAddress: string,
    notes: StoredNote[],
    blockHeight: number
  ): Promise<void> {
    if (!this.utxoStore[accountAddress]) {
      this.utxoStore[accountAddress] = { notes: [], version: 0, blockHeight: 0 };
    }

    this.utxoStore[accountAddress].notes = notes;
    this.utxoStore[accountAddress].version += 1;
    this.utxoStore[accountAddress].blockHeight = blockHeight;
    this.accountSyncState[accountAddress] = {
      ...this.getAccountSyncState(accountAddress),
      accountAddress,
      lastSyncedHeight: blockHeight,
      lastSyncedAt: Date.now(),
    };

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

  private sortWalletTransactions(accountAddress: string): void {
    if (!this.walletTxStore[accountAddress]) return;

    this.walletTxStore[accountAddress].sort((a, b) => {
      const aTime = a.confirmedAtTimestamp ? a.confirmedAtTimestamp * 1000 : a.createdAt;
      const bTime = b.confirmedAtTimestamp ? b.confirmedAtTimestamp * 1000 : b.createdAt;
      return bTime - aTime;
    });
  }

  private findWalletTransactionIndex(accountAddress: string, tx: Partial<WalletTransaction>): number {
    const transactions = this.walletTxStore[accountAddress] || [];
    const trackingTxId = tx.trackingTxId || tx.txHash;

    return transactions.findIndex(existing => {
      if (tx.id && existing.id === tx.id) return true;
      if (trackingTxId && (existing.trackingTxId === trackingTxId || existing.txHash === trackingTxId)) {
        return true;
      }
      return false;
    });
  }

  getAccountSyncState(accountAddress: string): AccountSyncState {
    return (
      this.accountSyncState[accountAddress] || {
        accountAddress,
        lastSyncedHeight: 0,
        lastSyncedAt: 0,
        historyInitialized: false,
        lastHistorySyncedTip: 0,
        lastHistoryBackfillAt: 0,
      }
    );
  }

  private setAccountSyncState(accountAddress: string, updates: Partial<AccountSyncState>): void {
    const current = this.getAccountSyncState(accountAddress);
    this.accountSyncState[accountAddress] = {
      ...current,
      ...updates,
      accountAddress,
      lastSyncedAt: updates.lastSyncedAt ?? Date.now(),
    };
  }

  async updateAccountSyncState(
    accountAddress: string,
    updates: Partial<AccountSyncState>
  ): Promise<void> {
    this.setAccountSyncState(accountAddress, updates);
    await this.saveAccountData();
  }

  /**
   * Add a new wallet transaction
   * Automatically persists to encrypted storage
   */
  async addWalletTransaction(tx: WalletTransaction): Promise<void> {
    if (!this.walletTxStore[tx.accountAddress]) {
      this.walletTxStore[tx.accountAddress] = [];
    }

    const existingIndex = this.findWalletTransactionIndex(tx.accountAddress, tx);
    if (existingIndex !== -1) {
      console.warn(`[Vault] Transaction ${tx.id} already exists, skipping add`);
      return;
    }

    // Add to beginning (most recent first)
    this.walletTxStore[tx.accountAddress].unshift(tx);
    this.sortWalletTransactions(tx.accountAddress);

    // Keep a larger window now that confirmed history is stored here too.
    if (this.walletTxStore[tx.accountAddress].length > 1000) {
      this.walletTxStore[tx.accountAddress] = this.walletTxStore[tx.accountAddress].slice(0, 1000);
    }

    await this.saveAccountData();
  }

  private upsertWalletTransactionInMemory(tx: WalletTransaction): void {
    if (!this.walletTxStore[tx.accountAddress]) {
      this.walletTxStore[tx.accountAddress] = [];
    }

    const txIndex = this.findWalletTransactionIndex(tx.accountAddress, tx);
    if (txIndex === -1) {
      this.walletTxStore[tx.accountAddress].unshift(tx);
    } else {
      const existing = this.walletTxStore[tx.accountAddress][txIndex];
      this.walletTxStore[tx.accountAddress][txIndex] = {
        ...existing,
        ...tx,
        id: existing.id,
        origin: existing.origin || tx.origin,
        inputNoteIds: existing.inputNoteIds || tx.inputNoteIds,
        expectedChange: existing.expectedChange ?? tx.expectedChange,
        expectedChangeNoteIds: existing.expectedChangeNoteIds || tx.expectedChangeNoteIds,
        recipient: existing.recipient || tx.recipient,
        sender: existing.sender || tx.sender,
        priceUsdAtTime: existing.priceUsdAtTime ?? tx.priceUsdAtTime,
        updatedAt: Date.now(),
      };
    }

    this.sortWalletTransactions(tx.accountAddress);
  }

  async upsertWalletTransaction(tx: WalletTransaction): Promise<void> {
    this.upsertWalletTransactionInMemory(tx);
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

    const txIndex = this.findWalletTransactionIndex(accountAddress, { id: txId });
    if (txIndex === -1) {
      console.warn(`[Vault] Transaction ${txId} not found for update`);
      return;
    }

    const existing = this.walletTxStore[accountAddress][txIndex];
    this.walletTxStore[accountAddress][txIndex] = {
      ...existing,
      ...updates,
      id: existing.id,
      origin: existing.origin || updates.origin,
      inputNoteIds: existing.inputNoteIds || updates.inputNoteIds,
      expectedChange: existing.expectedChange ?? updates.expectedChange,
      expectedChangeNoteIds: existing.expectedChangeNoteIds || updates.expectedChangeNoteIds,
      recipient: existing.recipient || updates.recipient,
      sender: existing.sender || updates.sender,
      priceUsdAtTime: existing.priceUsdAtTime ?? updates.priceUsdAtTime,
      updatedAt: Date.now(),
    };

    this.sortWalletTransactions(accountAddress);
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
          t.status === 'mempool_seen' ||
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

  private sumSeedValue(seeds?: Array<{ gift?: number }>): number {
    return (seeds || []).reduce((sum, seed) => sum + (seed.gift || 0), 0)
  }

  private getUniqueLockRootFromOutputs(outputs: NockblocksOutput[]): string | undefined {
    const lockRoots = new Set<string>()
    for (const output of outputs) {
      for (const seed of output.seeds || []) {
        if (seed.lockRoot) {
          lockRoots.add(seed.lockRoot)
        }
      }
    }
    return lockRoots.size === 1 ? [...lockRoots][0] : undefined
  }

  private getUniqueLockRootFromSpends(spends: NockblocksSpend[]): string | undefined {
    const spendLockRoots = new Set<string>()
    for (const spend of spends) {
      if (spend.lockRoot) {
        spendLockRoots.add(spend.lockRoot)
      }
    }

    if (spendLockRoots.size === 1) {
      return [...spendLockRoots][0]
    }

    if (spendLockRoots.size > 1) {
      return undefined
    }

    const seedLockRoots = new Set<string>()
    for (const spend of spends) {
      for (const seed of spend.seeds || []) {
        if (seed.lockRoot) {
          seedLockRoots.add(seed.lockRoot)
        }
      }
    }
    return seedLockRoots.size === 1 ? [...seedLockRoots][0] : undefined
  }

  private getTransactionTrackingId(tx: WalletTransaction): string | undefined {
    return tx.trackingTxId || tx.txHash
  }

  private async getOwnFirstNameSet(accountAddress: string): Promise<Set<string>> {
    const { simple, coinbase } = await getBothFirstNames(accountAddress)
    return new Set([simple, coinbase])
  }

  private buildWalletTransactionFromChainTransaction(
    accountAddress: string,
    tx: NockblocksTransaction,
    ownFirstNames: Set<string>
  ): WalletTransaction | null {
    const txId = tx.txId || tx.id
    if (!txId) {
      return null
    }

    const outputs = tx.outputs || tx.transaction?.outputs || []
    const spends = tx.spends || tx.transaction?.spends || []
    const ownOutputs = outputs.filter(
      (output: NockblocksOutput) => Boolean(output.firstName && ownFirstNames.has(output.firstName))
    )
    const externalOutputs = outputs.filter(
      (output: NockblocksOutput) => !output.firstName || !ownFirstNames.has(output.firstName)
    )
    const ownSpends = spends.filter(
      (spend: NockblocksSpend) => Boolean(spend.firstName && ownFirstNames.has(spend.firstName))
    )
    const externalSpends = spends.filter(
      (spend: NockblocksSpend) => !spend.firstName || !ownFirstNames.has(spend.firstName)
    )

    if (ownOutputs.length === 0 && ownSpends.length === 0) {
      return null
    }

    const ownOutputAmount = ownOutputs.reduce(
      (sum: number, output: NockblocksOutput) => sum + this.sumSeedValue(output.seeds),
      0
    )
    const externalOutputAmount = externalOutputs.reduce(
      (sum: number, output: NockblocksOutput) => sum + this.sumSeedValue(output.seeds),
      0
    )
    const fee = spends.reduce(
      (sum: number, spend: NockblocksSpend) => sum + (spend.fee || 0),
      0
    )

    let direction: WalletTransaction['direction'] = 'incoming'
    if (ownSpends.length > 0 && externalOutputs.length === 0) {
      direction = 'self'
    } else if (ownSpends.length > 0) {
      direction = 'outgoing'
    }

    const createdAt = (tx.timestamp || tx.heardAtTimestamp || Math.floor(Date.now() / 1000)) * 1000
    const amount =
      direction === 'incoming'
        ? ownOutputAmount
        : direction === 'self'
          ? ownOutputAmount
          : externalOutputAmount

    const recipient =
      direction === 'incoming'
        ? accountAddress
        : direction === 'self'
          ? accountAddress
          : this.getUniqueLockRootFromOutputs(externalOutputs)
    const sender =
      direction === 'incoming'
        ? this.getUniqueLockRootFromSpends(externalSpends)
        : accountAddress

    return {
      id: txId,
      txHash: txId,
      trackingTxId: txId,
      accountAddress,
      direction,
      createdAt,
      updatedAt: Date.now(),
      status: 'confirmed',
      origin: 'history_sync',
      amount,
      fee: direction === 'incoming' ? undefined : fee,
      recipient,
      sender,
      blockId: tx.blockId,
      confirmedAtBlock: tx.blockHeight,
      confirmedAtTimestamp: tx.timestamp,
      confirmationSource: 'history_sync',
      confirmations: tx.blockHeight ? 1 : undefined,
    }
  }

  private async refreshPendingTransactionStatuses(accountAddress: string): Promise<number> {
    if (!isNockblocksConfigured()) {
      return 0
    }

    const pendingTxs = this.getPendingOutgoingTransactions(accountAddress)
    if (pendingTxs.length === 0) {
      return 0
    }

    const client = createNockblocksClient()
    const ownFirstNames = await this.getOwnFirstNameSet(accountAddress)
    let confirmedCount = 0

    for (const tx of pendingTxs) {
      const trackingId = this.getTransactionTrackingId(tx)
      if (!trackingId) continue

      const now = Date.now()
      const ageMs = now - tx.createdAt
      const shouldCheckMempool =
        ageMs <= 5 * 60 * 1000 &&
        (!tx.lastMempoolCheckAt || now - tx.lastMempoolCheckAt >= 15 * 1000)

      if (shouldCheckMempool) {
        try {
          const mempoolTx = await client.getMempoolTransactionByTxid(trackingId)
          await this.updateWalletTransaction(accountAddress, tx.id, {
            status: mempoolTx ? 'mempool_seen' : tx.status,
            mempoolSeenAt: mempoolTx
              ? (mempoolTx.heardAtTimestamp || Math.floor(now / 1000)) * 1000
              : tx.mempoolSeenAt,
            lastMempoolCheckAt: now,
          })
        } catch (error) {
          console.warn('[Vault] Mempool check failed:', error)
        }
      }

      const confirmDelayMs = tx.mempoolSeenAt ? 15 * 1000 : 60 * 1000
      const shouldCheckConfirmation =
        ageMs >= confirmDelayMs &&
        (!tx.lastConfirmationCheckAt || now - tx.lastConfirmationCheckAt >= 30 * 1000)

      if (!shouldCheckConfirmation) {
        continue
      }

      try {
        const confirmedTx = await client.getTransactionByTxid(trackingId)
        if (!confirmedTx) {
          await this.updateWalletTransaction(accountAddress, tx.id, {
            lastConfirmationCheckAt: now,
          })
          continue
        }

        const chainTx = this.buildWalletTransactionFromChainTransaction(
          accountAddress,
          confirmedTx,
          ownFirstNames
        )

        await this.updateWalletTransaction(accountAddress, tx.id, {
          ...(chainTx || {}),
          status: 'confirmed',
          txHash: confirmedTx.txId || confirmedTx.id || trackingId,
          trackingTxId: confirmedTx.txId || confirmedTx.id || trackingId,
          blockId: confirmedTx.blockId,
          confirmedAtBlock: confirmedTx.blockHeight,
          confirmedAtTimestamp: confirmedTx.timestamp,
          confirmationSource: 'api',
          confirmations: confirmedTx.blockHeight ? 1 : tx.confirmations,
          lastConfirmationCheckAt: now,
        })
        confirmedCount++
      } catch (error) {
        console.warn('[Vault] Confirmation check failed:', error)
      }
    }

    return confirmedCount
  }

  private async syncConfirmedHistory(accountAddress: string): Promise<number> {
    if (!isNockblocksConfigured()) {
      return 0
    }

    const client = createNockblocksClient()
    const syncState = this.getAccountSyncState(accountAddress)
    const ownFirstNames = await this.getOwnFirstNameSet(accountAddress)
    const tip = await client.getTip()
    const historySyncWindow = 100
    const maxIncrementalHistoryBlocks = 500
    const lastHistorySyncedTip = syncState.lastHistorySyncedTip || tip.height
    const historyTipGap = Math.max(tip.height - lastHistorySyncedTip, 0)
    let syncedCount = 0

    if (
      !syncState.historyInitialized ||
      historyTipGap > maxIncrementalHistoryBlocks
    ) {
      const limit = 1000
      let offset = 0

      while (true) {
        const transactions = await client.getTransactionsByAddress(accountAddress, { limit, offset })
        if (transactions.length === 0) {
          break
        }

        for (const transaction of transactions) {
          const walletTx = this.buildWalletTransactionFromChainTransaction(
            accountAddress,
            transaction,
            ownFirstNames
          )
          if (!walletTx) continue
          this.upsertWalletTransactionInMemory(walletTx)
          syncedCount++
        }

        if (transactions.length < limit) {
          break
        }

        offset += transactions.length
      }

      this.setAccountSyncState(accountAddress, {
        historyInitialized: true,
        lastHistoryBackfillAt: Date.now(),
        lastHistorySyncedTip: tip.height,
        lastSyncedHeight: Math.max(syncState.lastSyncedHeight, tip.height),
      })
      await this.saveAccountData()

      return syncedCount
    }

    const startBlock = Math.max(
      Math.max(tip.height - historySyncWindow, 0),
      Math.min(lastHistorySyncedTip, tip.height)
    )
    const heights: number[] = []
    for (let height = startBlock; height <= tip.height; height++) {
      heights.push(height)
    }

    for (let i = 0; i < heights.length; i += 25) {
      const blocks = await client.getBlocksByHeight(heights.slice(i, i + 25))
      for (const block of blocks) {
        for (const transaction of block.transactions) {
          const walletTx = this.buildWalletTransactionFromChainTransaction(
            accountAddress,
            {
              ...transaction,
              blockId: transaction.blockId || block.blockId,
              blockHeight: transaction.blockHeight || block.height,
              timestamp: transaction.timestamp || block.timestamp,
            },
            ownFirstNames
          )

          if (!walletTx) continue
          this.upsertWalletTransactionInMemory(walletTx)
          syncedCount++
        }
      }
    }

    this.setAccountSyncState(accountAddress, {
      historyInitialized: true,
      lastHistorySyncedTip: tip.height,
      lastSyncedHeight: Math.max(syncState.lastSyncedHeight, tip.height),
    })
    await this.saveAccountData()

    return syncedCount
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

    const endpoint = await getEffectiveRpcEndpoint();
    const rpcClient = createBrowserClient(endpoint);

    return withAccountLock(accountAddress, async () => {
      const confirmedFromApi = await this.refreshPendingTransactionStatuses(accountAddress)
      await this.syncConfirmedHistory(accountAddress)

      // 1. Fetch current UTXOs from chain
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      const blockHeight = balanceResult.blockHeight;
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
              confirmationSource: tx.confirmationSource || 'utxo_fallback',
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
          // Don't create WalletTransaction records for incoming UTXOs.
          // Only outgoing transactions appear in history. Balance still updates correctly.
          newIncoming++;
        }

        newStoredNotes.push(storedNote);
      }

      // Save new notes
      if (newStoredNotes.length > 0) {
        await this.saveNotes(accountAddress, newStoredNotes, blockHeight);
      }

      // 5b. Check for pending transactions whose inputs are ALREADY spent
      let confirmedFromPreviousSpent = 0;
      const stillPendingTxs = pendingTxs.filter(
        tx => !areTransactionInputsSpent(tx, diff.nowSpent)
      );

      const currentNotes = this.getAccountNotes(accountAddress);

      if (stillPendingTxs.length > 0) {
        const spentNoteIds = new Set(
          currentNotes.filter(n => n.state === 'spent').map(n => n.noteId)
        );

        for (const tx of stillPendingTxs) {
          if (!tx.inputNoteIds || tx.inputNoteIds.length === 0) continue;

          const allInputsSpent = tx.inputNoteIds.every(noteId => spentNoteIds.has(noteId));

          if (allInputsSpent) {
            await this.updateWalletTransaction(accountAddress, tx.id, {
              status: 'confirmed',
              confirmationSource: tx.confirmationSource || 'utxo_fallback',
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

      // 7. Handle failed transactions
      const failedTxs = findFailedTransactions(allTxs, currentNotes);

      for (const failedTx of failedTxs) {
        if (failedTx.inputNoteIds && failedTx.inputNoteIds.length > 0) {
          await this.releaseInFlightNotes(accountAddress, failedTx.inputNoteIds);
        }

        await this.updateWalletTransaction(accountAddress, failedTx.id, {
          status: 'failed',
        });
      }

      // 8. Cleanup old spent notes to prevent storage bloat
      await this.removeSpentNotes(accountAddress);

      const confirmedFromNewSpent = pendingTxs.filter(tx =>
        areTransactionInputsSpent(tx, diff.nowSpent)
      ).length;

      return {
        newIncoming,
        newChange,
        spent: diff.nowSpent.length,
        confirmed: confirmedFromApi + confirmedFromNewSpent + confirmedFromPreviousSpent,
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

    const endpoint = await getEffectiveRpcEndpoint();
    const rpcClient = createBrowserClient(endpoint);

    return withAccountLock(accountAddress, async () => {
      // Check if already initialized
      const existingNotes = this.getAccountNotes(accountAddress);
      if (existingNotes.length > 0) {
        return;
      }

      // Fetch current UTXOs from chain
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      const blockHeight = balanceResult.blockHeight;
      const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

      // Convert to stored notes (all available, no incoming tx records on first init)
      const storedNotes: StoredNote[] = chainNotes.map(note =>
        noteToStoredNote(note, accountAddress, 'available')
      );

      // Save notes
      if (storedNotes.length > 0) {
        await this.saveNotes(accountAddress, storedNotes, blockHeight);
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

    const endpoint = await getEffectiveRpcEndpoint();
    const rpcClient = createBrowserClient(endpoint);

    return withAccountLock(accountAddress, async () => {
      // Fetch current UTXOs from chain (first-name only)
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      const blockHeight = balanceResult.blockHeight;
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
      await this.replaceAccountNotes(accountAddress, newStoredNotes, blockHeight);
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

    // Sign: WASM expects 32-byte private key; copy to avoid view-into-WASM-memory issues
    const pk = accountKey.privateKey;
    if (pk.byteLength !== 32) {
      if (currentAccount?.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Invalid private key length for signing');
    }
    const signingKeyBytes = new Uint8Array(pk.slice(0, 32));
    const signature = wasm.signMessage(signingKeyBytes, msgString);

    // Keep legacy payload format: old WASM exposed c/s as little-endian bytes.
    // New WASM exposes hex strings, so reverse byte order to preserve legacy compatibility.
    const toLegacyHex = (v: string | Uint8Array): number[] => {
      if (typeof v === 'string') {
        let bytes = [];
        for (let i = 0; i < v.length; i += 2) {
          bytes.push(parseInt(v.substr(i, 2), 16));
        }
        return bytes.reverse();
      }
      return [...v];
    };
    const signatureJson = JSON.stringify({
      c: toLegacyHex(signature.c),
      s: toLegacyHex(signature.s),
    });

    // Log whether the signature verifies (helps detect old SDK / old WASM API mismatch)
    try {
      const pubKey = accountKey.publicKey as Uint8Array;
      if (pubKey.byteLength === 97 && typeof wasm.verifySignature === 'function') {
        const pubKeyBytes = new Uint8Array(pubKey.slice(0, 97));
        const valid = wasm.verifySignature(pubKeyBytes, signature, msgString);
        console.log('[vault] sign_message verification:', valid ? 'valid' : 'invalid');
      } else {
        console.log(
          '[vault] sign_message verification: skipped (pubKey not 97 bytes or verifySignature not available)'
        );
      }
    } catch (e) {
      console.warn('[vault] sign_message verification failed:', e);
    }

    // Convert public key to hex string for easy transport
    const publicKeyHex = Array.from(accountKey.publicKey as Uint8Array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Signature is plain data in new API; no explicit free needed.
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
  async signTransaction(to: string, amount: Nicks, fee?: Nicks): Promise<string> {
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

    const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

    try {
      const endpoint = await getEffectiveRpcEndpoint();
      const rpcClient = createBrowserClient(endpoint);
      const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

      if (balanceResult.utxoCount === 0) {
        throw new Error('No UTXOs available. Your wallet may have zero balance.');
      }

      // Combine simple and coinbase notes
      const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
      const blockHeight = balanceResult.blockHeight;

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
        privateKey,
        fee,
        undefined,
        blockHeight
      );

      // Return constructed transaction (for caller to broadcast)
      return constructedTx.txId;
    } finally {
      privateKey.free();
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
    amount: Nicks
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

      const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

      try {
        const endpoint = await getEffectiveRpcEndpoint();
        const rpcClient = createBrowserClient(endpoint);
        const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

        if (balanceResult.utxoCount === 0) {
          return { error: 'No UTXOs available. Your wallet may have zero balance.' };
        }

        const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
        const blockHeight = balanceResult.blockHeight;

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
          privateKey,
          undefined, // let WASM auto-calc
          undefined,
          blockHeight
        );

        // Get the calculated fee from the builder
        return { fee: constructedTx.feeUsed };
      } finally {
        privateKey.free();
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

      const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

      try {
        // Get available (not in-flight) notes from in-memory UTXO store
        const notes = this.getAvailableNotes(currentAccount.address);
        const blockHeight = this.getAccountBlockHeight(currentAccount.address);

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
          String(estimationAmount),
          accountKey.publicKey,
          privateKey,
          undefined, // let WASM auto-calc fee
          to, // refundPKH = recipient (sweep mode)
          blockHeight
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
        privateKey.free();
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
    amount: Nicks,
    fee?: Nicks
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

      const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

      try {
        const endpoint = await getEffectiveRpcEndpoint();
        const rpcClient = createBrowserClient(endpoint);
        const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

        if (balanceResult.utxoCount === 0) {
          return { error: 'No UTXOs available. Your wallet may have zero balance.' };
        }

        // Combine simple and coinbase notes
        const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
        const blockHeight = balanceResult.blockHeight;
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
          privateKey,
          fee,
          undefined,
          blockHeight
        );

        // Convert to protobuf format for gRPC and broadcast
        const protobufTx = nockchainTxToProtobuf(constructedTx.nockchainTx);
        await rpcClient.sendTransaction(protobufTx);

        return {
          txId: constructedTx.txId,
          broadcasted: true,
          protobufTx, // Include protobuf for debugging/export
        };
      } finally {
        privateKey.free();
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
    amount: Nicks,
    fee?: Nicks,
    sendMax?: boolean,
    priceUsdAtTime?: number,
    origin: WalletTransaction['origin'] = 'popup_send'
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

        const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

        try {
          // 1. Get available notes from in-memory UTXO store (for state tracking)
          const availableStoredNotes = this.getAvailableNotes(currentAccount.address);
          const blockHeight = this.getAccountBlockHeight(currentAccount.address);

          if (availableStoredNotes.length === 0) {
            return { error: 'No available UTXOs.' };
          }

          const totalAvailable = availableStoredNotes.reduce((sum, n) => sum + n.assets, 0);

          // 2. Estimate fee if not provided (rough estimate: 2 NOCK should cover most cases)
          const estimatedFeeNum = fee !== undefined ? Number(fee) : 2 * NOCK_TO_NICKS;

          let selectedStoredNotes: typeof availableStoredNotes;
          let expectedChange: number;

          if (sendMax) {
            // SEND MAX: Use ALL available UTXOs, no change back to sender
            selectedStoredNotes = availableStoredNotes;
            expectedChange = 0; // All goes to recipient (minus fee)
          } else {
            // NORMAL: Select only notes needed for amount + fee
            const targetAmount = Number(amount) + estimatedFeeNum;
            const selected = selectNotesForAmount(availableStoredNotes, targetAmount);

            if (!selected) {
              return {
                error: `Insufficient available funds`,
              };
            }

            selectedStoredNotes = selected;
            const selectedTotal = selectedStoredNotes.reduce((sum, n) => sum + n.assets, 0);
            expectedChange = selectedTotal - Number(amount) - estimatedFeeNum;
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
            origin,
            inputNoteIds: selectedNoteIds,
            recipient: to,
            amount: Number(amount),
            fee: estimatedFeeNum,
            expectedChange: expectedChange > 0 ? expectedChange : 0,
          };
          await this.addWalletTransaction(walletTx);

          // 6. Convert stored notes to transaction builder format
          const sortedStoredNotes = [...selectedStoredNotes].sort((a, b) => b.assets - a.assets);
          const txBuilderNotes = sortedStoredNotes.map(convertStoredNoteForTxBuilder);

          const endpoint = await getEffectiveRpcEndpoint();
          const rpcClient = createBrowserClient(endpoint);

          // For sendMax: set refundPKH = recipient so all funds go to recipient (sweep)
          const refundAddress = sendMax ? to : undefined;

          const constructedTx = await buildMultiNotePayment(
            txBuilderNotes,
            to,
            amount,
            accountKey.publicKey,
            privateKey,
            fee,
            refundAddress,
            blockHeight
          );

          // 7. Broadcast transaction
          await this.updateWalletTransaction(currentAccount.address, walletTxId, {
            status: 'broadcast_pending',
          });
          const protobufTx = nockchainTxToProtobuf(constructedTx.nockchainTx);
          await rpcClient.sendTransaction(protobufTx);

          // 8. Update tx status to broadcasted
          walletTx.fee = constructedTx.feeUsed;
          walletTx.txHash = constructedTx.txId;
          walletTx.trackingTxId = constructedTx.txId;
          walletTx.status = 'broadcasted_unconfirmed';
          await this.updateWalletTransaction(currentAccount.address, walletTxId, {
            fee: constructedTx.feeUsed,
            txHash: constructedTx.txId,
            trackingTxId: constructedTx.txId,
            status: 'broadcasted_unconfirmed',
            lastMempoolCheckAt: Date.now(),
            lastConfirmationCheckAt: 0,
          });

          return {
            txId: constructedTx.txId,
            walletTx,
            broadcasted: true,
          };
        } finally {
          privateKey.free();
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
    rawTx: wasm.RawTx;
    notes: wasm.Note[];
    spendConditions: wasm.SpendCondition[];
  }): Promise<any> {
    // Returns protobuf wasm.RawTx
    if (this.state.locked || !this.mnemonic) {
      throw new Error('Wallet is locked');
    }

    // Initialize WASM modules
    await initWasmModules();

    const { rawTx, notes, spendConditions } = params;
    assertNativeRawTx(rawTx);
    notes.forEach(assertNativeNote);
    spendConditions.forEach(assertNativeSpendCondition);

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

    const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

    const endpoint = await getEffectiveRpcEndpoint();
    const rpcClient = createBrowserClient(endpoint);

    try {
      // Use block height from latest balance (max originPage of current account's notes)
      const accountNotes = currentAccount ? this.getAccountNotes(currentAccount.address) : [];
      const blockHeight = currentAccount
        ? this.getAccountBlockHeight(currentAccount.address)
        : await rpcClient.getCurrentBlockHeight();

      const settings = await txEngineSettings(blockHeight);
      const builder = wasm.TxBuilder.fromTx(rawTx, notes, spendConditions, settings);

      await builder.sign(privateKey);

      // Validate before build (surfaces missing unlocks, fee, balanced spends)
      builder.validate();

      // Build signed tx (returns NockchainTx)
      const signedTx = builder.build();

      // Convert to protobuf for return
      const protobuf = nockchainTxToProtobuf(signedTx);

      return protobuf;
    } finally {
      privateKey.free();

      if (currentAccount?.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
    }
  }

  async computeOutputs(rawTx: wasm.RawTx): Promise<any[]> {
    if (this.state.locked || !this.mnemonic) {
      throw new Error('Wallet is locked');
    }

    // Initialize WASM modules
    await initWasmModules();

    try {
      assertNativeRawTx(rawTx);
      const outputs = wasm.rawTxOutputs(rawTx);
      return outputs.map(output => wasm.noteToProtobuf(output));
    } catch (err) {
      console.error('Failed to compute outputs:', err);
      throw err;
    }
  }
}
