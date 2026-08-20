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
  NOCK_TO_NICKS,
  MAX_SUBWALLET_DISCOVERY_SCAN,
} from './constants';
import {
  DEFAULT_WALLET_STYLE,
  TOTAL_STYLE_COMBINATIONS,
  getPresetWalletStyle,
  normalizeIconStyleId,
  type WalletStyle,
} from './walletStyles';
import { SubAccount, SeedAccount } from './types';
import {
  buildMultiNotePayment,
  buildUnsignedMultiNotePayment,
  discoverSpendConditionForNote,
  type Note,
} from './transaction-builder';
import wasm from './sdk-wasm.js';
import { queryV1Balance } from './balance-query';
import { createBrowserClient } from './rpc-client-browser';
import type {
  Note as BalanceNote,
  UTXOStore,
  WalletTxStore,
  SyncStateStore,
  AccountSyncState,
} from './types';
import {
  assertRpcNetworkIdentity,
  defaultRpcConfig,
  getEffectiveRpcConfig,
  getEffectiveRpcEndpoint,
  getRpcNetworkIdentity,
  getTransactionContextSnapshot,
} from './rpc-config';
import { base58 } from '@scure/base';
import { initWasmModules } from './wasm-utils';
import {
  withAccountLock,
  fetchedToStoredNote,
  noteToStoredNote,
  generateNoteId,
  reserveAvailableNotes,
  releaseOwnedNoteReservations,
  releaseUnownedOnChainReservations,
  recoverInterruptedExactReservations,
  stageExactTransactionReservation,
  stageAdditionalTransactionReservation,
} from './utxo-utils';
import {
  computeUTXODiff,
  classifyNewUTXO,
  findFailedTransactions,
  findExpiredTransactions,
  areTransactionInputsSpent,
  matchChangeOutputs,
} from './utxo-diff';
import type {
  BuiltSimpleTransaction,
  StoredNote,
  TransactionApprovalContext,
  WalletTransaction,
  FetchedUTXO,
} from './types';
import { assertNativeRawTx } from './sign-raw-tx-compat';
import type { SignMessageResponse } from '@nockbox/iris-sdk';
import type { Digest, Nicks } from '@nockbox/iris-sdk/wasm';
import { guard } from '@nockbox/iris-sdk/wasm';
import { getTxEngineSettingsForHeight } from './rpc-config';
import { getBothFirstNames } from './first-name-derivation';
import {
  createNockblocksClient,
  isNockblocksConfigured,
  type NockblocksOutput,
  type NockblocksSeed,
  type NockblocksSpend,
  type NockblocksTransaction,
} from './nockblocks-client.js';
import { buildBridgeTransaction, validateBridgeTransaction } from '@nockbox/iris-sdk';
import { BRIDGE_CONFIG } from './bridge-config';
import { rewriteInsufficientFeeErrorToDecimalNock } from './currency';
import {
  assertMatchingTransactionIntent,
  buildWithAdvisoryFeeRetry,
  resolveBuiltInputSelection,
  resolveBuiltTransactionAmounts,
} from './transaction-fee';
import { SerializedTaskQueue } from './serialized-task-queue';

type SendTransactionV2Options = {
  /** Advisory fee for note selection only. WASM still calculates the actual fee. */
  feeSelectionHint?: Nicks;
  /** Account that was bound to the approval request. */
  accountAddress?: string;
};

type BuiltSimpleTransactionWithContext = BuiltSimpleTransaction & {
  transactionContext: TransactionApprovalContext;
};

async function txEngineSettings(blockHeight: number): Promise<wasm.TxEngineSettings> {
  return await getTxEngineSettingsForHeight(blockHeight);
}

async function latestConfiguredTxEngineHeight(): Promise<number> {
  const config = await getEffectiveRpcConfig();
  const heights = config.txEngineActivationHeights || {};
  const latestHeight = Object.keys(heights)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  if (latestHeight === undefined) {
    throw new Error('No tx engine settings configured');
  }

  return latestHeight;
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
interface LegacyVaultPayload {
  mnemonic: string;
  accounts: SubAccount[];
}

interface VaultPayloadV2 {
  version: 2;
  seedAccounts: SeedAccount[];
}

type VaultPayload = LegacyVaultPayload | VaultPayloadV2;

interface VaultState {
  locked: boolean;
  accounts: SubAccount[];
  currentAccountIndex: number;
  enc: EncryptedVault | null;
}

function feeEstimateUserFacingError(error: unknown, kind: 'fee' | 'max' | 'build'): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/digest|canonical|base58|iris-wasm|Digest guard/i.test(raw)) {
    return kind === 'max'
      ? 'Could not estimate the maximum send for that recipient. Use a valid Nockchain address.'
      : kind === 'build'
        ? 'Could not build a transaction for that recipient. Use a valid Nockchain address.'
        : 'Could not estimate the network fee for that recipient. Use a valid Nockchain address.';
  }
  const readable = rewriteInsufficientFeeErrorToDecimalNock(raw);
  const prefix =
    kind === 'max'
      ? 'Max send estimation failed: '
      : kind === 'build'
        ? 'Transaction build failed: '
        : 'Fee estimation failed: ';
  return prefix + readable;
}

/**
 * Collect `id` / `txHash` / `trackingTxId` for matching a Nockblocks row to an existing
 * {@link WalletTransaction} (e.g. bridge uses UUID `id` + on-chain `txHash` only until we align).
 */
function walletTxIdentityStrings(tx: Partial<WalletTransaction>): string[] {
  const out = new Set<string>();
  for (const key of ['id', 'txHash', 'trackingTxId'] as const) {
    const v = tx[key];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.length > 0) out.add(t);
    }
  }
  return [...out];
}

function walletTxSharesAnyIdentifier(
  a: Partial<WalletTransaction>,
  b: Partial<WalletTransaction>
): boolean {
  const sa = new Set(walletTxIdentityStrings(a));
  for (const x of walletTxIdentityStrings(b)) {
    if (sa.has(x)) return true;
  }
  return false;
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

  /** Decrypted seed account sources (mnemonic/external) */
  private seedAccounts: SeedAccount[] = [];

  /** Derived encryption key (only stored in memory while unlocked, cleared on lock) */
  private encryptionKey: CryptoKey | null = null;

  /** Decrypted UTXO store (only stored in memory while unlocked)*/
  private utxoStore: UTXOStore = {};

  /** Decrypted wallet transactions (only stored in memory while unlocked) */
  private walletTxStore: WalletTxStore = {};

  /** Per-account sync metadata for history and polling */
  private accountSyncState: SyncStateStore = {};

  /** Serialize Nockblocks history refreshes per account (avoid overlapping background syncs). */
  private nockblocksHistoryRefreshChains = new Map<string, Promise<void>>();

  /** Serialize full-account-blob writes so an older snapshot cannot win a race. */
  private accountDataSaveQueue = new SerializedTaskQueue();

  /** Invalidates queued writes when lock/reset begins. */
  private accountDataEpoch = 0;

  /** Password and cached-key unlocks share one admission slot. */
  private unlockAttemptActive = false;

  private beginUnlockAttempt(): (() => void) | null {
    if (this.unlockAttemptActive || !this.state.locked) return null;
    this.unlockAttemptActive = true;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.unlockAttemptActive = false;
    };
  }

  private currentUnlockResult():
    | {
        ok: boolean;
        address: string;
        accounts: SubAccount[];
        currentAccount: SubAccount;
        activeSeedSourceId: string | null;
      }
    | { error: string } {
    const currentAccount = this.getCurrentAccount();
    if (this.state.locked || !currentAccount) {
      return { error: 'Unlock is already in progress' };
    }
    return {
      ok: true,
      address: currentAccount.address,
      accounts: this.getAccounts(),
      currentAccount,
      activeSeedSourceId: this.getActiveSeedSourceId(),
    };
  }

  /** Cached balances per account (only stored in memory while unlocked) */
  private cachedBalances: Record<string, number> = {};

  private isVaultPayloadV2(payload: VaultPayload): payload is VaultPayloadV2 {
    return 'version' in payload && payload.version === 2 && Array.isArray(payload.seedAccounts);
  }

  private getSeedOrdinal(seedAccountId: string): number {
    const idx = this.seedAccounts.findIndex(seed => seed.id === seedAccountId);
    return idx >= 0 ? idx + 1 : 1;
  }

  private getDefaultMasterWalletName(seedOrdinal: number): string {
    return `Wallet ${seedOrdinal}`;
  }

  private getDefaultChildWalletName(seedOrdinal: number, childOrdinal: number): string {
    return `Wallet ${seedOrdinal}.${childOrdinal}`;
  }

  private isMasterAccount(account: SubAccount | null | undefined): boolean {
    return (account?.index ?? -1) === 0;
  }

  private clearDecryptedStateAfterFailedUnlock(): void {
    this.state.locked = true;
    this.state.accounts = [];
    this.state.currentAccountIndex = 0;
    this.mnemonic = null;
    this.seedAccounts = [];
    this.encryptionKey = null;
    this.utxoStore = {};
    this.walletTxStore = {};
    this.accountSyncState = {};
    this.cachedBalances = {};
    this.nockblocksHistoryRefreshChains.clear();
  }

  /**
   * Returns a style (icon + color) not already used by any account across all seeds.
   *
   * Walks the deterministic preset sequence (see `getPresetWalletStyle`) and
   * returns the first combination still free, so new wallets get a varied but
   * predictable look. Only once every combination is taken does it fall back
   * to the default style.
   */
  private pickUnusedStyleGlobally(): WalletStyle {
    const allAccounts = this.seedAccounts.flatMap(seed => seed.accounts);
    const usedKeys = new Set(
      allAccounts.map(
        a =>
          `${normalizeIconStyleId(a.iconStyleId)}-${a.iconColor ?? DEFAULT_WALLET_STYLE.iconColor}`
      )
    );
    for (let i = 0; i < TOTAL_STYLE_COMBINATIONS; i++) {
      const preset = getPresetWalletStyle(i);
      if (!usedKeys.has(`${preset.iconStyleId}-${preset.iconColor}`)) {
        return preset;
      }
    }
    return { ...DEFAULT_WALLET_STYLE };
  }

  private createSeedAccountFromLegacy(mnemonic: string, legacyAccounts: SubAccount[]): SeedAccount {
    const seedAccountId = crypto.randomUUID();
    const seedOrdinal = this.getSeedOrdinal(seedAccountId);
    const normalizedAccounts: SubAccount[] = legacyAccounts.map((account, idx) => {
      const accountIndex = typeof account.index === 'number' ? account.index : idx;
      return {
        name:
          account.name ||
          (accountIndex === 0
            ? this.getDefaultMasterWalletName(seedOrdinal)
            : this.getDefaultChildWalletName(seedOrdinal, accountIndex)),
        address: account.address,
        index: accountIndex,
        iconStyleId: account.iconStyleId,
        iconColor: account.iconColor,
        hidden: account.hidden,
        createdAt: account.createdAt,
      };
    });

    return {
      id: seedAccountId,
      name: this.getDefaultMasterWalletName(seedOrdinal),
      type: 'mnemonic',
      mnemonic,
      createdAt: Date.now(),
      accounts: normalizedAccounts,
    };
  }

  private normalizeSeedAccount(seedAccount: SeedAccount, seedOrdinal: number): SeedAccount {
    const seedId = seedAccount.id || crypto.randomUUID();
    return {
      ...seedAccount,
      id: seedId,
      name: seedAccount.name || this.getDefaultMasterWalletName(seedOrdinal),
      accounts: (seedAccount.accounts || []).map((account, idx) => {
        const accountIndex = typeof account.index === 'number' ? account.index : idx;
        const { derivation: _derivation, ...accountWithoutDerivation } = account as SubAccount & {
          derivation?: 'master' | 'slip10';
        };
        const normalized: SubAccount = {
          ...accountWithoutDerivation,
          index: accountIndex,
          name:
            account.name ||
            (accountIndex === 0
              ? this.getDefaultMasterWalletName(seedOrdinal)
              : this.getDefaultChildWalletName(seedOrdinal, accountIndex)),
        };

        return normalized;
      }),
    };
  }

  private decodeVaultPayload(rawPayload: string): {
    seedAccounts: SeedAccount[];
    migrated: boolean;
  } {
    const parsed = JSON.parse(rawPayload) as VaultPayload;

    if (this.isVaultPayloadV2(parsed)) {
      return {
        seedAccounts: parsed.seedAccounts.map((seedAccount, idx) =>
          this.normalizeSeedAccount(seedAccount, idx + 1)
        ),
        migrated: false,
      };
    }

    return {
      seedAccounts: [this.createSeedAccountFromLegacy(parsed.mnemonic, parsed.accounts || [])],
      migrated: true,
    };
  }

  private rebuildFlatAccounts(): void {
    this.state.accounts = this.seedAccounts.flatMap(seedAccount => seedAccount.accounts);
    if (this.state.accounts.length === 0) {
      this.state.currentAccountIndex = 0;
      return;
    }
    if (this.state.currentAccountIndex >= this.state.accounts.length) {
      this.state.currentAccountIndex = 0;
    }
  }

  private getSeedAccountForWallet(account: SubAccount | null): SeedAccount | null {
    if (!account) return null;
    return (
      this.seedAccounts.find(seed => seed.accounts.some(a => a.address === account.address)) || null
    );
  }

  private getCurrentAccountUnchecked(): SubAccount | null {
    const account = this.state.accounts[this.state.currentAccountIndex];
    if (account && !account.hidden) return account;
    return this.state.accounts.find(candidate => !candidate.hidden) || null;
  }

  private getSigningMnemonicForCurrentAccount(): string | null {
    const currentAccount = this.getCurrentAccountUnchecked();
    const seedAccount = this.getSeedAccountForWallet(currentAccount);
    if (!seedAccount || seedAccount.type !== 'mnemonic') {
      return null;
    }
    return seedAccount.mnemonic || null;
  }

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
    const setupLifecycleEpoch = this.accountDataEpoch;
    // Generate or validate mnemonic
    const words = mnemonic ? mnemonic.trim() : generateMnemonic();
    if (mnemonic && !validateMnemonic(words)) {
      return { error: ERROR_CODES.INVALID_MNEMONIC };
    }

    // Create first account (Wallet 1 at index 0)
    // Use the default style for consistent initial experience
    const firstPreset = DEFAULT_WALLET_STYLE;

    const masterAddress = await deriveAddressFromMaster(words);

    const firstSeedAccount: SeedAccount = {
      id: crypto.randomUUID(),
      name: 'Wallet 1',
      type: 'mnemonic',
      mnemonic: words,
      createdAt: Date.now(),
      accounts: [
        {
          name: 'Wallet 1',
          address: masterAddress,
          index: 0,
          iconStyleId: firstPreset.iconStyleId,
          iconColor: firstPreset.iconColor,
          createdAt: Date.now(),
        },
      ],
    };

    // Generate PBKDF2 salt and derive encryption key
    const kdfSalt = rand(16);
    const { key } = await deriveKeyPBKDF2(password, kdfSalt);

    // Encrypt both mnemonic AND accounts together
    const vaultPayload: VaultPayloadV2 = {
      version: 2,
      seedAccounts: [firstSeedAccount],
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

    try {
      await this.accountDataSaveQueue.run(async () => {
        if (setupLifecycleEpoch !== this.accountDataEpoch) {
          throw new Error('Vault setup was cancelled because the wallet lifecycle changed');
        }

        // Only store encrypted vault and current account index. Setup shares
        // the lifecycle persistence queue so a later reset is guaranteed to
        // clear this write, even when PBKDF/encryption is still in flight.
        await chrome.storage.local.set({
          [STORAGE_KEYS.ENCRYPTED_VAULT]: encData,
          [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: 0,
        });
        if (setupLifecycleEpoch !== this.accountDataEpoch) {
          throw new Error('Vault setup was cancelled because the wallet lifecycle changed');
        }

        // Keep wallet unlocked after setup for smooth onboarding UX.
        this.mnemonic = words;
        this.encryptionKey = key;
        this.seedAccounts = [firstSeedAccount];
        this.state = {
          locked: false,
          accounts: [...firstSeedAccount.accounts],
          currentAccountIndex: 0,
          enc: encData,
        };
      });
    } catch {
      return { error: ERROR_CODES.LOCKED };
    }

    return { ok: true, address: firstSeedAccount.accounts[0].address, mnemonic: words };
  }

  /**
   * Unlocks the vault with the provided password
   */
  async unlock(password: string): Promise<
    | {
        ok: boolean;
        address: string;
        accounts: SubAccount[];
        currentAccount: SubAccount;
        activeSeedSourceId: string | null;
      }
    | { error: string }
  > {
    const releaseUnlockAttempt = this.beginUnlockAttempt();
    if (!releaseUnlockAttempt) {
      return this.currentUnlockResult();
    }
    try {
      const unlockLifecycleEpoch = this.accountDataEpoch;
      let decryptedStateInstalled = false;
      // Never load an older blob while a save from the previous unlocked session
      // is still completing.
      await this.accountDataSaveQueue.drain();
      if (unlockLifecycleEpoch !== this.accountDataEpoch) {
        return { error: ERROR_CODES.LOCKED };
      }
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

        const decoded = this.decodeVaultPayload(pt);
        const decodedAccounts = decoded.seedAccounts.flatMap(seedAccount => seedAccount.accounts);

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
          }
        }

        // Migration: fallback from legacy unencrypted stores
        if (!loadedFromEncrypted) {
          const legacyUtxoStore = stored[STORAGE_KEYS.UTXO_STORE] as UTXOStore | undefined;
          const legacyWalletTxStore = stored[STORAGE_KEYS.WALLET_TX_STORE] as
            | WalletTxStore
            | undefined;
          const legacyCachedBalances = stored[STORAGE_KEYS.CACHED_BALANCES] as
            | Record<string, number>
            | undefined;

          utxoStore = legacyUtxoStore || {};
          walletTxStore = legacyWalletTxStore || {};
          cachedBalances = legacyCachedBalances || {};
        }

        // A later lock/reset wins over this slow decrypt. Commit all decrypted
        // state synchronously only if the lifecycle epoch is still current.
        if (unlockLifecycleEpoch !== this.accountDataEpoch) {
          return { error: ERROR_CODES.LOCKED };
        }
        this.seedAccounts = decoded.seedAccounts;
        this.encryptionKey = key;
        this.utxoStore = utxoStore;
        this.walletTxStore = walletTxStore;
        this.accountSyncState = accountSyncState;
        this.cachedBalances = cachedBalances;

        const resolvedIndex =
          currentAccountIndex >= 0 && currentAccountIndex < decodedAccounts.length
            ? currentAccountIndex
            : 0;
        this.state = {
          // Keep decrypted state unpublished until recovery/migration durability
          // work has completed successfully.
          locked: true,
          accounts: decodedAccounts,
          currentAccountIndex: resolvedIndex,
          enc,
        };
        decryptedStateInstalled = true;
        this.mnemonic = this.getSigningMnemonicForCurrentAccount();
        const recoveredInterruptedExactTransactions = this.recoverInterruptedExactTransactions();

        const currentAccount = this.state.accounts[resolvedIndex] || this.state.accounts[0];

        // Persist legacy payload migration + legacy store migration
        if (decoded.migrated) {
          await this.saveAccountsToVault();
          if (unlockLifecycleEpoch !== this.accountDataEpoch) {
            return { error: ERROR_CODES.LOCKED };
          }
        }
        if (!loadedFromEncrypted) {
          const hasData =
            Object.keys(utxoStore).length > 0 ||
            Object.keys(walletTxStore).length > 0 ||
            Object.keys(cachedBalances).length > 0 ||
            Object.keys(accountSyncState).length > 0;
          if (hasData) {
            await this.saveAccountData();
            if (unlockLifecycleEpoch !== this.accountDataEpoch) {
              return { error: ERROR_CODES.LOCKED };
            }
            await chrome.storage.local.remove([
              STORAGE_KEYS.UTXO_STORE,
              STORAGE_KEYS.WALLET_TX_STORE,
              STORAGE_KEYS.CACHED_BALANCES,
            ]);
          }
        } else if (recoveredInterruptedExactTransactions) {
          await this.saveAccountData();
        }
        if (unlockLifecycleEpoch !== this.accountDataEpoch) {
          return { error: ERROR_CODES.LOCKED };
        }
        this.state.locked = false;
        return {
          ok: true,
          address: currentAccount?.address || '',
          accounts: this.state.accounts,
          currentAccount,
          activeSeedSourceId: this.getSeedAccountForWallet(currentAccount)?.id || null,
        };
      } catch (err) {
        if (decryptedStateInstalled) {
          this.clearDecryptedStateAfterFailedUnlock();
        }
        return {
          error:
            decryptedStateInstalled || unlockLifecycleEpoch !== this.accountDataEpoch
              ? ERROR_CODES.LOCKED
              : ERROR_CODES.BAD_PASSWORD,
        };
      }
    } finally {
      releaseUnlockAttempt();
    }
  }

  /**
   * Unlocks the vault using a cached encryption key (used for session restore)
   */
  async unlockWithKey(key: CryptoKey): Promise<
    | {
        ok: boolean;
        address: string;
        accounts: SubAccount[];
        currentAccount: SubAccount;
        activeSeedSourceId: string | null;
      }
    | { error: string }
  > {
    const releaseUnlockAttempt = this.beginUnlockAttempt();
    if (!releaseUnlockAttempt) {
      return this.currentUnlockResult();
    }
    try {
      const unlockLifecycleEpoch = this.accountDataEpoch;
      await this.accountDataSaveQueue.drain();
      if (unlockLifecycleEpoch !== this.accountDataEpoch) {
        return { error: ERROR_CODES.LOCKED };
      }
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.ENCRYPTED_VAULT,
        STORAGE_KEYS.ENCRYPTED_ACCOUNT_DATA,
        STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
        STORAGE_KEYS.UTXO_STORE,
        STORAGE_KEYS.WALLET_TX_STORE,
        STORAGE_KEYS.CACHED_BALANCES,
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

      const decoded = this.decodeVaultPayload(pt);
      const decodedAccounts = decoded.seedAccounts.flatMap(seedAccount => seedAccount.accounts);

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
          for (const utxoKey in utxoStore) {
            if (utxoStore[utxoKey].blockHeight == null) {
              console.log('[Vault] Clearing old UTXO store with no blockHeight');
              delete utxoStore[utxoKey];
            }
          }
          walletTxStore = accountData.walletTxStore || {};
          accountSyncState = accountData.accountSyncState || {};
          cachedBalances = accountData.cachedBalances || {};
          loadedFromEncrypted = true;
        }
      }

      if (!loadedFromEncrypted) {
        const legacyUtxoStore = stored[STORAGE_KEYS.UTXO_STORE] as UTXOStore | undefined;
        const legacyWalletTxStore = stored[STORAGE_KEYS.WALLET_TX_STORE] as
          | WalletTxStore
          | undefined;
        const legacyCachedBalances = stored[STORAGE_KEYS.CACHED_BALANCES] as
          | Record<string, number>
          | undefined;

        utxoStore = legacyUtxoStore || {};
        walletTxStore = legacyWalletTxStore || {};
        cachedBalances = legacyCachedBalances || {};
      }

      if (unlockLifecycleEpoch !== this.accountDataEpoch) {
        return { error: ERROR_CODES.LOCKED };
      }
      this.seedAccounts = decoded.seedAccounts;
      this.encryptionKey = key;
      this.utxoStore = utxoStore;
      this.walletTxStore = walletTxStore;
      this.accountSyncState = accountSyncState;
      this.cachedBalances = cachedBalances;

      const resolvedIndex =
        currentAccountIndex >= 0 && currentAccountIndex < decodedAccounts.length
          ? currentAccountIndex
          : 0;

      this.state = {
        locked: true,
        accounts: decodedAccounts,
        currentAccountIndex: resolvedIndex,
        enc,
      };
      this.mnemonic = this.getSigningMnemonicForCurrentAccount();
      try {
        const recoveredInterruptedExactTransactions = this.recoverInterruptedExactTransactions();

        const currentAccount = this.state.accounts[resolvedIndex] || this.state.accounts[0];
        if (decoded.migrated) {
          await this.saveAccountsToVault();
          if (unlockLifecycleEpoch !== this.accountDataEpoch) {
            return { error: ERROR_CODES.LOCKED };
          }
        }
        if (!loadedFromEncrypted) {
          const hasData =
            Object.keys(this.utxoStore).length > 0 ||
            Object.keys(this.walletTxStore).length > 0 ||
            Object.keys(this.cachedBalances).length > 0 ||
            Object.keys(this.accountSyncState).length > 0;
          if (hasData) {
            await this.saveAccountData();
            if (unlockLifecycleEpoch !== this.accountDataEpoch) {
              return { error: ERROR_CODES.LOCKED };
            }
            await chrome.storage.local.remove([
              STORAGE_KEYS.UTXO_STORE,
              STORAGE_KEYS.WALLET_TX_STORE,
              STORAGE_KEYS.CACHED_BALANCES,
            ]);
          }
        } else if (recoveredInterruptedExactTransactions) {
          await this.saveAccountData();
        }
        if (unlockLifecycleEpoch !== this.accountDataEpoch) {
          return { error: ERROR_CODES.LOCKED };
        }
        this.state.locked = false;
        return {
          ok: true,
          address: currentAccount?.address || '',
          accounts: this.state.accounts,
          currentAccount,
          activeSeedSourceId: this.getSeedAccountForWallet(currentAccount)?.id || null,
        };
      } catch {
        this.clearDecryptedStateAfterFailedUnlock();
        return { error: ERROR_CODES.LOCKED };
      }
    } finally {
      releaseUnlockAttempt();
    }
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
    const epoch = this.accountDataEpoch;
    await this.accountDataSaveQueue.run(async () => {
      if (epoch !== this.accountDataEpoch || !this.state.enc || !this.encryptionKey) {
        throw new Error('Cannot save accounts: vault is locked or lifecycle changed');
      }

      // Capture the latest account list only when this ordered task executes.
      const vaultPayload: VaultPayloadV2 = {
        version: 2,
        seedAccounts: this.seedAccounts,
      };
      const payloadJson = JSON.stringify(vaultPayload);
      const { iv, ct } = await encryptGCM(
        this.encryptionKey,
        new TextEncoder().encode(payloadJson)
      );
      if (epoch !== this.accountDataEpoch || !this.state.enc) {
        throw new Error('Cannot save accounts: vault lifecycle changed');
      }

      const encData: EncryptedVault = {
        version: 1,
        kdf: this.state.enc.kdf,
        cipher: {
          alg: 'AES-GCM',
          iv: Array.from(iv),
          ct: Array.from(ct),
        },
      };

      await chrome.storage.local.set({ [STORAGE_KEYS.ENCRYPTED_VAULT]: encData });
      if (epoch !== this.accountDataEpoch) {
        throw new Error('Cannot save accounts: vault lifecycle changed');
      }
      this.state.enc = encData;
    });
  }

  /**
   * Locks the vault
   */
  async lock(): Promise<{ ok: boolean }> {
    this.state.locked = true;
    this.accountDataEpoch += 1;
    await this.accountDataSaveQueue.run(async () => {
      // Clear sensitive data only after any already-running encrypted write has
      // settled. Queued writes from the old epoch fail before taking a snapshot.
      this.state.accounts = []; // Clear accounts to enforce "no addresses while locked"
      this.mnemonic = null;
      this.seedAccounts = [];
      this.encryptionKey = null;
      this.utxoStore = {};
      this.walletTxStore = {};
      this.accountSyncState = {};
      this.cachedBalances = {};
      this.nockblocksHistoryRefreshChains.clear();
    });
    return { ok: true };
  }

  /**
   * Resets/deletes the wallet completely (clears all data)
   */
  async reset(): Promise<{ ok: boolean }> {
    this.state.locked = true;
    this.accountDataEpoch += 1;
    await this.accountDataSaveQueue.run(async () => {
      // Ordered after every already-running account-data write so none can
      // recreate ENCRYPTED_ACCOUNT_DATA after the clear.
      await chrome.storage.local.clear();

      this.state = {
        locked: true,
        accounts: [],
        currentAccountIndex: 0,
        enc: null,
      };
      this.mnemonic = null;
      this.seedAccounts = [];
      this.encryptionKey = null; // Clear encryption key as well
      this.utxoStore = {};
      this.walletTxStore = {};
      this.accountSyncState = {};
      this.cachedBalances = {};
      this.nockblocksHistoryRefreshChains.clear();
    });

    return { ok: true };
  }

  /**
   * Returns whether the vault is currently locked
   */
  isLocked(): boolean {
    return this.state.locked;
  }

  /**
   * Gets the currently selected sub-account from the flattened account list.
   */
  getCurrentAccount(): SubAccount | null {
    if (this.state.locked) return null;
    // currentAccountIndex refers to the flattened `state.accounts` array position,
    // not the per-seed derivation index on SubAccount.index.
    return this.getCurrentAccountUnchecked();
  }

  /**
   * Gets the current address (only when unlocked)
   */
  getAddress(): string {
    const account = this.getCurrentAccount();
    return account?.address || '';
  }

  /** Whether the selected account has local key material available for signing. */
  canCurrentAccountSignLocally(): boolean {
    return !this.state.locked && this.getSigningMnemonicForCurrentAccount() !== null;
  }

  /**
   * Returns the flattened sub-account list across all seed sources.
   */
  getAccounts(): SubAccount[] {
    return this.state.locked ? [] : this.state.accounts;
  }

  /**
   * Gets the seed source ID for the currently selected account
   */
  getActiveSeedSourceId(): string | null {
    const currentAccount = this.getCurrentAccount();
    return this.getSeedAccountForWallet(currentAccount)?.id || null;
  }

  /**
   * Gets top-level seed/external account sources (mnemonic removed)
   */
  getSeedSources(): Array<Omit<SeedAccount, 'mnemonic'>> {
    if (this.state.locked) return [];
    return this.seedAccounts.map(({ mnemonic: _mnemonic, ...seed }) => seed);
  }

  /**
   * Creates a new mnemonic-based top-level account source (master derivation account)
   */
  async createMnemonicSeedSource(
    mnemonic?: string,
    name?: string
  ): Promise<
    | { seedSource: Omit<SeedAccount, 'mnemonic'>; account: SubAccount; mnemonic: string }
    | { error: string }
  > {
    if (this.state.locked || !this.state.enc || !this.encryptionKey) {
      return { error: ERROR_CODES.LOCKED };
    }

    const words = mnemonic ? mnemonic.trim() : generateMnemonic();
    if (mnemonic && !validateMnemonic(words)) {
      return { error: ERROR_CODES.INVALID_MNEMONIC };
    }

    // Detect duplicate: same mnemonic already exists in the vault
    const existing = this.seedAccounts.find(s => s.type === 'mnemonic' && s.mnemonic === words);
    if (existing) {
      // If the master account is hidden, restore it (and all its sub-accounts)
      const masterHidden = existing.accounts.some(a => a.index === 0 && a.hidden);
      if (masterHidden) {
        existing.accounts.forEach(a => {
          a.hidden = false;
        });
        this.rebuildFlatAccounts();
        const newFlatIndex = this.state.accounts.findIndex(
          acc => acc.address === existing.accounts.find(a => a.index === 0)?.address
        );
        if (newFlatIndex >= 0) {
          this.state.currentAccountIndex = newFlatIndex;
          await chrome.storage.local.set({
            [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: newFlatIndex,
          });
        }
        this.mnemonic = words;
        await this.saveAccountsToVault();
        const { mnemonic: _m, ...publicSeed } = existing;
        return {
          seedSource: publicSeed,
          account: existing.accounts.find(a => a.index === 0)!,
          mnemonic: words,
        };
      }
      return { error: ERROR_CODES.DUPLICATE_SEED };
    }

    const seedOrdinal = this.seedAccounts.length + 1;
    const seedId = crypto.randomUUID();
    const { iconStyleId, iconColor } = this.pickUnusedStyleGlobally();
    const masterName = name?.trim() || this.getDefaultMasterWalletName(seedOrdinal);
    const masterAddress = await deriveAddressFromMaster(words);

    const masterAccount: SubAccount = {
      name: masterName,
      address: masterAddress,
      index: 0,
      iconStyleId,
      iconColor,
      createdAt: Date.now(),
    };

    const seedAccount: SeedAccount = {
      id: seedId,
      name: masterName,
      type: 'mnemonic',
      mnemonic: words,
      createdAt: Date.now(),
      accounts: [masterAccount],
    };

    this.seedAccounts.push(seedAccount);
    this.rebuildFlatAccounts();

    const newFlatIndex = this.state.accounts.findIndex(acc => acc.address === masterAddress);
    this.state.currentAccountIndex =
      newFlatIndex >= 0 ? newFlatIndex : this.state.accounts.length - 1;
    this.mnemonic = words;

    await Promise.all([
      this.saveAccountsToVault(),
      chrome.storage.local.set({
        [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: this.state.currentAccountIndex,
      }),
    ]);

    const { mnemonic: _mnemonic, ...publicSeed } = seedAccount;
    return { seedSource: publicSeed, account: masterAccount, mnemonic: words };
  }

  /**
   * Creates an external top-level account source (e.g. Ledger)
   */
  async createExternalSeedSource(params: {
    address: string;
    name?: string;
    provider?: 'ledger' | 'unknown';
    sourceRef?: string;
    accountRef?: string;
  }): Promise<
    { seedSource: Omit<SeedAccount, 'mnemonic'>; account: SubAccount } | { error: string }
  > {
    if (this.state.locked || !this.state.enc || !this.encryptionKey) {
      return { error: ERROR_CODES.LOCKED };
    }
    if (!params.address || typeof params.address !== 'string') {
      return { error: ERROR_CODES.INVALID_PARAMS };
    }
    const alreadyExists = this.seedAccounts.some(seed =>
      seed.accounts.some(account => account.address === params.address)
    );
    if (alreadyExists) {
      return { error: ERROR_CODES.DUPLICATE_SEED };
    }

    const seedOrdinal = this.seedAccounts.length + 1;
    const seedId = crypto.randomUUID();
    const provider = params.provider || 'unknown';
    const masterName = params.name?.trim() || this.getDefaultMasterWalletName(seedOrdinal);
    const { iconStyleId, iconColor } = this.pickUnusedStyleGlobally();

    const externalMasterAccount: SubAccount = {
      name: masterName,
      address: params.address,
      index: 0,
      iconStyleId,
      iconColor,
      createdAt: Date.now(),
    };

    const seedAccount: SeedAccount = {
      id: seedId,
      name: masterName,
      type: 'external',
      createdAt: Date.now(),
      accounts: [externalMasterAccount],
      external: {
        provider,
        sourceRef: params.sourceRef,
      },
    };

    this.seedAccounts.push(seedAccount);
    this.rebuildFlatAccounts();

    const newFlatIndex = this.state.accounts.findIndex(acc => acc.address === params.address);
    this.state.currentAccountIndex =
      newFlatIndex >= 0 ? newFlatIndex : this.state.accounts.length - 1;
    this.mnemonic = null;

    await Promise.all([
      this.saveAccountsToVault(),
      chrome.storage.local.set({
        [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: this.state.currentAccountIndex,
      }),
    ]);

    const { mnemonic: _mnemonic, ...publicSeed } = seedAccount;
    return { seedSource: publicSeed, account: externalMasterAccount };
  }

  /**
   * Gets the address safely (even when locked, from storage)
   * NOTE: Accounts are encrypted, so this only works when unlocked
   * This is intentional - better privacy, addresses not accessible without password
   */
  async getAddressSafe(): Promise<string> {
    if (this.state.locked) return '';
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

  private getCachedAccountBlockHeight(accountAddress: string): number {
    const syncState = this.accountSyncState[accountAddress];
    return Math.max(
      this.getAccountBlockHeight(accountAddress),
      syncState?.lastSyncedHeight ?? 0,
      syncState?.lastHistorySyncedTip ?? 0
    );
  }

  /** Heal exact sends interrupted before their signed transaction id was persisted. */
  private recoverInterruptedExactTransactions(): boolean {
    let changed = false;
    const accountAddresses = new Set([
      ...Object.keys(this.utxoStore),
      ...Object.keys(this.walletTxStore),
    ]);
    for (const accountAddress of accountAddresses) {
      const accountStore = this.utxoStore[accountAddress];
      const transactions = this.walletTxStore[accountAddress] ?? [];
      const recovered = recoverInterruptedExactReservations(
        accountStore?.notes ?? [],
        transactions,
        accountAddress
      );
      if (recovered.released > 0 && accountStore) {
        accountStore.version += 1;
      }
      if (recovered.failed > 0) {
        changed = true;
      }
    }
    return changed;
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
  private async persistAccountDataSnapshot(): Promise<void> {
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

  async saveAccountData(): Promise<void> {
    // The payload is captured inside the queued task, not when the caller
    // enqueues it. This prevents a slow older encryption/write from overwriting
    // a newer mutation to another account in the same encrypted blob.
    const epoch = this.accountDataEpoch;
    await this.accountDataSaveQueue.run(async () => {
      if (epoch !== this.accountDataEpoch) {
        throw new Error('Account data save was cancelled because the vault lifecycle changed');
      }
      await this.persistAccountDataSnapshot();
    });
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
      lastSyncedHeight: Math.max(
        this.getAccountSyncState(accountAddress).lastSyncedHeight,
        blockHeight
      ),
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

    reserveAvailableNotes(
      this.utxoStore[accountAddress].notes,
      accountAddress,
      noteIds,
      walletTxId
    );

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
  async releaseInFlightNotes(
    accountAddress: string,
    noteIds: string[],
    walletTxId: string
  ): Promise<void> {
    if (!this.utxoStore[accountAddress]) return;

    const released = releaseOwnedNoteReservations(
      this.utxoStore[accountAddress].notes,
      accountAddress,
      noteIds,
      walletTxId
    );

    if (released === 0) return;

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

  private capWalletTransactions(accountAddress: string): void {
    const transactions = this.walletTxStore[accountAddress];
    if (!transactions || transactions.length <= 1000) return;

    const isNonterminal = (transaction: WalletTransaction) =>
      transaction.status === 'created' ||
      transaction.status === 'broadcast_pending' ||
      transaction.status === 'mempool_seen' ||
      transaction.status === 'broadcasted_unconfirmed';
    const pendingCount = transactions.filter(isNonterminal).length;
    let terminalBudget = Math.max(0, 1000 - pendingCount);
    const retained = transactions.filter(transaction => {
      if (isNonterminal(transaction)) return true;
      if (terminalBudget === 0) return false;
      terminalBudget -= 1;
      return true;
    });

    // Keep the same array reference so an in-progress staged transaction can
    // restore it on persistence failure.
    transactions.splice(0, transactions.length, ...retained);
  }

  /** Reserve inputs and add history in one encrypted account-data snapshot. */
  private async reserveNotesAndCreateWalletTransaction(
    accountAddress: string,
    noteIds: readonly string[],
    walletTx: WalletTransaction
  ): Promise<void> {
    const epoch = this.accountDataEpoch;
    await this.accountDataSaveQueue.run(async () => {
      if (epoch !== this.accountDataEpoch || this.state.locked) {
        throw new Error('Transaction reservation was cancelled because the vault locked');
      }
      const accountStore = this.utxoStore[accountAddress];
      if (!accountStore) {
        throw new Error(`No UTXO store for account ${accountAddress}`);
      }

      const hadTransactionStore = Boolean(this.walletTxStore[accountAddress]);
      const transactions = (this.walletTxStore[accountAddress] ??= []);
      const previousTransactions = [...transactions];
      const previousVersion = accountStore.version;
      const staged = stageExactTransactionReservation(
        accountStore.notes,
        transactions,
        accountAddress,
        noteIds,
        walletTx
      );
      accountStore.version += 1;
      this.sortWalletTransactions(accountAddress);
      this.capWalletTransactions(accountAddress);
      const evictedTransactions = previousTransactions.filter(
        transaction => !transactions.includes(transaction)
      );

      try {
        await this.persistAccountDataSnapshot();
      } catch (error) {
        staged.rollback();
        for (const evicted of evictedTransactions) {
          if (!transactions.some(transaction => transaction.id === evicted.id)) {
            transactions.push(evicted);
          }
        }
        this.sortWalletTransactions(accountAddress);
        accountStore.version = previousVersion;
        if (!hadTransactionStore && transactions.length === 0) {
          delete this.walletTxStore[accountAddress];
        }
        throw error;
      }
    });
  }

  /** Add owner-bound reservations to an existing history record in one snapshot. */
  private async reserveAdditionalTransactionNotes(
    accountAddress: string,
    noteIds: readonly string[],
    walletTxId: string
  ): Promise<void> {
    if (noteIds.length === 0) return;
    const epoch = this.accountDataEpoch;
    await this.accountDataSaveQueue.run(async () => {
      if (epoch !== this.accountDataEpoch || this.state.locked) {
        throw new Error('Transaction reservation was cancelled because the vault locked');
      }
      const accountStore = this.utxoStore[accountAddress];
      const transaction = this.walletTxStore[accountAddress]?.find(tx => tx.id === walletTxId);
      if (!accountStore || !transaction) {
        throw new Error('Transaction reservation history is unavailable');
      }
      const previousVersion = accountStore.version;
      const staged = stageAdditionalTransactionReservation(
        accountStore.notes,
        transaction,
        accountAddress,
        noteIds
      );
      accountStore.version += 1;
      try {
        await this.persistAccountDataSnapshot();
      } catch (error) {
        staged.rollback();
        accountStore.version = previousVersion;
        throw error;
      }
    });
  }

  /** Release an unsubmitted exact send and fail its history in one snapshot. */
  private async failUnsubmittedExactTransaction(
    accountAddress: string,
    noteIds: readonly string[],
    walletTxId: string
  ): Promise<void> {
    const epoch = this.accountDataEpoch;
    await this.accountDataSaveQueue.run(async () => {
      if (epoch !== this.accountDataEpoch || this.state.locked) {
        throw new Error('Transaction cleanup was cancelled because the vault locked');
      }
      const accountStore = this.utxoStore[accountAddress];
      const transactions = this.walletTxStore[accountAddress];
      if (!accountStore || !transactions) return;

      const ownedNotes = accountStore.notes.filter(
        note =>
          noteIds.includes(note.noteId) &&
          note.accountAddress === accountAddress &&
          note.state === 'in_flight' &&
          note.pendingTxId === walletTxId
      );
      const transaction = transactions.find(candidate => candidate.id === walletTxId);
      const previousStatus = transaction?.status;
      const previousUpdatedAt = transaction?.updatedAt;
      const previousVersion = accountStore.version;

      const released = releaseOwnedNoteReservations(
        accountStore.notes,
        accountAddress,
        noteIds,
        walletTxId
      );
      if (released > 0) accountStore.version += 1;
      if (transaction) {
        transaction.status = 'failed';
        transaction.updatedAt = Date.now();
        this.sortWalletTransactions(accountAddress);
      }
      if (released === 0 && !transaction) return;

      try {
        await this.persistAccountDataSnapshot();
      } catch (error) {
        for (const note of ownedNotes) {
          note.state = 'in_flight';
          note.pendingTxId = walletTxId;
        }
        accountStore.version = previousVersion;
        if (transaction && previousStatus && transaction.status === 'failed') {
          transaction.status = previousStatus;
          transaction.updatedAt = previousUpdatedAt ?? transaction.updatedAt;
          this.sortWalletTransactions(accountAddress);
        }
        throw error;
      }
    });
  }

  private findWalletTransactionIndex(
    accountAddress: string,
    tx: Partial<WalletTransaction>
  ): number {
    const transactions = this.walletTxStore[accountAddress] || [];
    if (walletTxIdentityStrings(tx).length === 0) {
      return -1;
    }
    return transactions.findIndex(existing => walletTxSharesAnyIdentifier(tx, existing));
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

  private assertAccountSyncedForNetwork(
    accountAddress: string,
    currentNetworkIdentity: string
  ): void {
    const syncState = this.getAccountSyncState(accountAddress);
    if (syncState.utxoSyncInProgress) {
      throw new Error('Wallet data sync was interrupted; sync again before transacting');
    }
    assertRpcNetworkIdentity(syncState.rpcNetworkIdentity, currentNetworkIdentity);
  }

  private assertAccountOperationCurrent(accountAddress: string, lifecycleEpoch: number): void {
    if (
      this.state.locked ||
      lifecycleEpoch !== this.accountDataEpoch ||
      !this.state.accounts.some(account => account.address === accountAddress)
    ) {
      throw new Error('Wallet lifecycle changed during account sync');
    }
  }

  private async persistCompletedAccountSync(
    accountAddress: string,
    updates: Partial<AccountSyncState>
  ): Promise<void> {
    this.setAccountSyncState(accountAddress, { ...updates, utxoSyncInProgress: false });
    try {
      await this.saveAccountData();
    } catch (error) {
      // The durable snapshot remains fenced from the initial in-progress save;
      // keep the in-memory copy fenced too after a failed final commit.
      this.setAccountSyncState(accountAddress, { utxoSyncInProgress: true });
      throw error;
    }
  }

  async accountNeedsSyncForCurrentNetwork(accountAddress: string): Promise<boolean> {
    const currentIdentity = getRpcNetworkIdentity(await getEffectiveRpcConfig());
    const state = this.getAccountSyncState(accountAddress);
    return state.utxoSyncInProgress === true || state.rpcNetworkIdentity !== currentIdentity;
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
    this.capWalletTransactions(tx.accountAddress);

    await this.saveAccountData();
  }

  private upsertWalletTransactionInMemory(
    tx: WalletTransaction,
    opts?: { skipSort?: boolean }
  ): void {
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
        migrationFromV0: existing.migrationFromV0 || tx.migrationFromV0,
        kind: existing.kind || tx.kind,
        updatedAt: Date.now(),
      };
    }

    if (!opts?.skipSort) {
      this.sortWalletTransactions(tx.accountAddress);
      this.capWalletTransactions(tx.accountAddress);
    }
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
      migrationFromV0: existing.migrationFromV0 || updates.migrationFromV0,
      kind: existing.kind || updates.kind,
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

  private getPendingTrackableTransactions(accountAddress: string): WalletTransaction[] {
    const transactions = this.getWalletTransactions(accountAddress);
    return transactions.filter(
      t =>
        (t.direction === 'outgoing' || t.migrationFromV0) &&
        Boolean(t.trackingTxId || t.txHash) &&
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
    return (seeds || []).reduce((sum, seed) => sum + (seed.gift || 0), 0);
  }

  private getUniqueLockRootFromOutputs(outputs: NockblocksOutput[]): string | undefined {
    const lockRoots = new Set<string>();
    for (const output of outputs) {
      for (const seed of output.seeds || []) {
        if (seed.lockRoot) {
          lockRoots.add(seed.lockRoot);
        }
      }
    }
    return lockRoots.size === 1 ? [...lockRoots][0] : undefined;
  }

  private getUniqueLockRootFromSpends(spends: NockblocksSpend[]): string | undefined {
    const spendLockRoots = new Set<string>();
    for (const spend of spends) {
      if (spend.lockRoot) {
        spendLockRoots.add(spend.lockRoot);
      }
    }

    if (spendLockRoots.size === 1) {
      return [...spendLockRoots][0];
    }

    if (spendLockRoots.size > 1) {
      return undefined;
    }

    const seedLockRoots = new Set<string>();
    for (const spend of spends) {
      for (const seed of spend.seeds || []) {
        if (seed.lockRoot) {
          seedLockRoots.add(seed.lockRoot);
        }
      }
    }
    return seedLockRoots.size === 1 ? [...seedLockRoots][0] : undefined;
  }

  private nockblocksNoteDataHasBridgePayload(noteData: NockblocksSeed['noteData']): boolean {
    if (!noteData || typeof noteData !== 'object') {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(noteData, BRIDGE_CONFIG.noteDataKey);
  }

  private nockblocksTxHasBridgeInNoteData(
    spends: NockblocksSpend[],
    outputs: NockblocksOutput[]
  ): boolean {
    for (const spend of spends) {
      for (const seed of spend.seeds || []) {
        if (this.nockblocksNoteDataHasBridgePayload(seed.noteData)) {
          return true;
        }
      }
    }
    for (const output of outputs) {
      for (const seed of output.seeds || []) {
        if (this.nockblocksNoteDataHasBridgePayload(seed.noteData)) {
          return true;
        }
      }
    }
    return false;
  }

  private getTransactionTrackingId(tx: WalletTransaction): string | undefined {
    return tx.trackingTxId || tx.txHash;
  }

  private async getOwnFirstNameSet(accountAddress: string): Promise<Set<string>> {
    const { simple, coinbase } = await getBothFirstNames(accountAddress);
    return new Set([simple, coinbase]);
  }

  private buildWalletTransactionFromChainTransaction(
    accountAddress: string,
    tx: NockblocksTransaction,
    ownFirstNames: Set<string>
  ): WalletTransaction | null {
    const txId = tx.txId || tx.id;
    if (!txId) {
      return null;
    }

    const outputs = tx.outputs || tx.transaction?.outputs || [];
    const spends = tx.spends || tx.transaction?.spends || [];
    const ownOutputs = outputs.filter((output: NockblocksOutput) =>
      Boolean(output.firstName && ownFirstNames.has(output.firstName))
    );
    const externalOutputs = outputs.filter(
      (output: NockblocksOutput) => !output.firstName || !ownFirstNames.has(output.firstName)
    );
    const ownSpends = spends.filter((spend: NockblocksSpend) =>
      Boolean(spend.firstName && ownFirstNames.has(spend.firstName))
    );
    const externalSpends = spends.filter(
      (spend: NockblocksSpend) => !spend.firstName || !ownFirstNames.has(spend.firstName)
    );

    if (ownOutputs.length === 0 && ownSpends.length === 0) {
      return null;
    }

    const ownOutputAmount = ownOutputs.reduce(
      (sum: number, output: NockblocksOutput) => sum + this.sumSeedValue(output.seeds),
      0
    );
    const externalOutputAmount = externalOutputs.reduce(
      (sum: number, output: NockblocksOutput) => sum + this.sumSeedValue(output.seeds),
      0
    );
    const fee = spends.reduce((sum: number, spend: NockblocksSpend) => sum + (spend.fee || 0), 0);

    let direction: WalletTransaction['direction'] = 'incoming';
    if (ownSpends.length > 0 && externalOutputs.length === 0) {
      direction = 'self';
    } else if (ownSpends.length > 0) {
      direction = 'outgoing';
    }

    const createdAt = (tx.timestamp || tx.heardAtTimestamp || Math.floor(Date.now() / 1000)) * 1000;
    const amount =
      direction === 'incoming'
        ? ownOutputAmount
        : direction === 'self'
          ? ownOutputAmount
          : externalOutputAmount;

    const recipient =
      direction === 'incoming'
        ? accountAddress
        : direction === 'self'
          ? accountAddress
          : this.getUniqueLockRootFromOutputs(externalOutputs);

    // v0→v1 migration: spends normally include `version: "v0_to_v1"` + `signaturesV0[].pubkey`.
    // Indexers sometimes omit `version` while still returning signatures — still treat as v0.
    const migrationV0Pubkey = externalSpends
      .flatMap((spend: NockblocksSpend) => spend.signaturesV0 || [])
      .find(sig => typeof sig?.pubkey === 'string' && sig.pubkey.trim().length > 0)
      ?.pubkey?.trim();

    const migrationSpend = externalSpends.find((spend: NockblocksSpend) => {
      const v = spend.version;
      return v === 'v0_to_v1' || (typeof v === 'string' && v.toLowerCase() === 'v0_to_v1');
    });

    const hasV0MigrationSpendEvidence =
      Boolean(migrationSpend) || (direction === 'incoming' && Boolean(migrationV0Pubkey));

    const sender =
      direction === 'incoming'
        ? (migrationV0Pubkey ?? this.getUniqueLockRootFromSpends(externalSpends))
        : accountAddress;

    const migrationFromV0 =
      direction === 'incoming' &&
      (hasV0MigrationSpendEvidence ||
        (typeof sender === 'string' &&
          sender.length >= 60 &&
          typeof recipient === 'string' &&
          recipient.length > 0 &&
          recipient.length < 60));

    const isBridgeFromNockblocksData =
      (direction === 'outgoing' || direction === 'self') &&
      this.nockblocksTxHasBridgeInNoteData(spends, outputs);

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
      ...(migrationFromV0 ? { migrationFromV0: true as const } : {}),
      ...(isBridgeFromNockblocksData ? { kind: 'bridge' as const } : {}),
      blockId: tx.blockId,
      confirmedAtBlock: tx.blockHeight,
      confirmedAtTimestamp: tx.timestamp,
      confirmationSource: 'history_sync',
      confirmations: tx.blockHeight ? 1 : undefined,
    };
  }

  private async refreshPendingTransactionStatuses(
    accountAddress: string,
    assertCurrent: () => void = () => undefined
  ): Promise<number> {
    if (!isNockblocksConfigured()) {
      return 0;
    }

    const pendingTxs = this.getPendingTrackableTransactions(accountAddress);
    if (pendingTxs.length === 0) {
      return 0;
    }

    const client = createNockblocksClient();
    const ownFirstNames = await this.getOwnFirstNameSet(accountAddress);
    assertCurrent();
    let confirmedCount = 0;

    for (const tx of pendingTxs) {
      const trackingId = this.getTransactionTrackingId(tx);
      if (!trackingId) continue;

      const now = Date.now();
      const ageMs = now - tx.createdAt;
      let mempoolSeenAt = tx.mempoolSeenAt;
      const shouldCheckMempool =
        ageMs <= 5 * 60 * 1000 &&
        (!tx.lastMempoolCheckAt || now - tx.lastMempoolCheckAt >= 15 * 1000);

      if (shouldCheckMempool) {
        try {
          const mempoolTx = await client.getMempoolTransactionByTxid(trackingId);
          assertCurrent();
          mempoolSeenAt = mempoolTx
            ? (mempoolTx.heardAtTimestamp || Math.floor(now / 1000)) * 1000
            : tx.mempoolSeenAt;
          await this.updateWalletTransaction(accountAddress, tx.id, {
            status: mempoolTx ? 'mempool_seen' : tx.status,
            mempoolSeenAt,
            lastMempoolCheckAt: now,
          });
        } catch (error) {
          console.warn('[Vault] Mempool check failed:', error);
        }
      }

      const confirmDelayMs = mempoolSeenAt ? 15 * 1000 : 60 * 1000;
      const shouldCheckConfirmation =
        ageMs >= confirmDelayMs &&
        (!tx.lastConfirmationCheckAt || now - tx.lastConfirmationCheckAt >= 30 * 1000);

      if (!shouldCheckConfirmation) {
        continue;
      }

      try {
        const confirmedTx = await client.getTransactionByTxid(trackingId);
        assertCurrent();
        if (!confirmedTx) {
          await this.updateWalletTransaction(accountAddress, tx.id, {
            lastConfirmationCheckAt: now,
          });
          continue;
        }

        const chainTx = this.buildWalletTransactionFromChainTransaction(
          accountAddress,
          confirmedTx,
          ownFirstNames
        );

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
        });
        confirmedCount++;
      } catch (error) {
        console.warn('[Vault] Confirmation check failed:', error);
      }
    }

    return confirmedCount;
  }

  private finalizeBulkWalletTxIngest(accountAddress: string): void {
    this.sortWalletTransactions(accountAddress);
    this.capWalletTransactions(accountAddress);
  }

  private enqueueNockblocksHistoryRefresh(
    accountAddress: string,
    fn: () => Promise<void>
  ): Promise<void> {
    const prev = this.nockblocksHistoryRefreshChains.get(accountAddress) ?? Promise.resolve();
    const next = prev
      .catch(() => {
        /* keep chain alive even if prior refresh failed */
      })
      .then(fn);
    this.nockblocksHistoryRefreshChains.set(accountAddress, next);
    return next;
  }

  /**
   * Pull confirmed txs from Nockblocks `getTransactionsByAddress` and merge into `walletTxStore`.
   *
   * @param opts.maxPages — cap pages per call (incremental reconcile); omit for full backfill pagination.
   * @returns `abortedEmptyFirstPage` when offset 0 returned no txs yet (indexer lag / new address).
   *          Caller must NOT set `historyInitialized` in that case, or incremental mode will never
   *          re-query old history by address.
   */
  private async ingestNockblocksTransactionsByAddress(
    accountAddress: string,
    ownFirstNames: Set<string>,
    client: ReturnType<typeof createNockblocksClient>,
    opts?: { maxPages?: number; assertCurrent?: () => void }
  ): Promise<{ ingested: number; abortedEmptyFirstPage: boolean }> {
    const limit = 1000;
    let offset = 0;
    let ingested = 0;
    let seenNonemptyPage = false;
    const maxPages = opts?.maxPages ?? Number.POSITIVE_INFINITY;

    for (let page = 0; page < maxPages; page++) {
      const historyTransactions = await client.getTransactionsByAddress(accountAddress, {
        limit,
        offset,
      });
      opts?.assertCurrent?.();
      if (historyTransactions.length === 0) {
        return { ingested, abortedEmptyFirstPage: offset === 0 && !seenNonemptyPage };
      }
      seenNonemptyPage = true;

      for (const transaction of historyTransactions) {
        const walletTx = this.buildWalletTransactionFromChainTransaction(
          accountAddress,
          transaction,
          ownFirstNames
        );
        if (!walletTx) continue;
        this.upsertWalletTransactionInMemory(walletTx, { skipSort: true });
        ingested++;
      }
      this.finalizeBulkWalletTxIngest(accountAddress);

      if (historyTransactions.length < limit) {
        return { ingested, abortedEmptyFirstPage: false };
      }
      offset += historyTransactions.length;
    }

    return { ingested, abortedEmptyFirstPage: false };
  }

  private async syncConfirmedHistory(
    accountAddress: string,
    opts?: { retryAddressIndexOnEmptyPage?: boolean; assertCurrent?: () => void }
  ): Promise<number> {
    if (!isNockblocksConfigured()) {
      return 0;
    }

    const client = createNockblocksClient();
    const syncState = this.getAccountSyncState(accountAddress);
    const ownFirstNames = await this.getOwnFirstNameSet(accountAddress);
    opts?.assertCurrent?.();
    const tip = await client.getTip();
    opts?.assertCurrent?.();
    const maxIncrementalHistoryBlocks = 500;
    const lastHistorySyncedTip = syncState.lastHistorySyncedTip ?? 0;
    const historyTipGap = Math.max(tip.height - lastHistorySyncedTip, 0);
    let syncedCount = 0;

    if (!syncState.historyInitialized || historyTipGap > maxIncrementalHistoryBlocks) {
      let ingestResult = await this.ingestNockblocksTransactionsByAddress(
        accountAddress,
        ownFirstNames,
        client,
        { assertCurrent: opts?.assertCurrent }
      );

      if (ingestResult.abortedEmptyFirstPage && opts?.retryAddressIndexOnEmptyPage) {
        await new Promise<void>(resolve => setTimeout(resolve, 1500));
        opts?.assertCurrent?.();
        ingestResult = await this.ingestNockblocksTransactionsByAddress(
          accountAddress,
          ownFirstNames,
          client,
          { assertCurrent: opts?.assertCurrent }
        );
      }

      syncedCount = ingestResult.ingested;

      if (ingestResult.abortedEmptyFirstPage) {
        return syncedCount;
      }

      this.setAccountSyncState(accountAddress, {
        historyInitialized: true,
        lastHistoryBackfillAt: Date.now(),
        lastHistorySyncedTip: tip.height,
        lastSyncedHeight: Math.max(syncState.lastSyncedHeight, tip.height),
      });
      opts?.assertCurrent?.();
      await this.saveAccountData();
      opts?.assertCurrent?.();

      return syncedCount;
    }

    const startBlock = lastHistorySyncedTip + 1;
    const heights: number[] = [];
    for (let height = startBlock; height <= tip.height; height++) {
      heights.push(height);
    }

    for (let i = 0; i < heights.length; i += 25) {
      const blocks = await client.getBlocksByHeight(heights.slice(i, i + 25));
      opts?.assertCurrent?.();
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
          );

          if (!walletTx) continue;
          this.upsertWalletTransactionInMemory(walletTx, { skipSort: true });
          syncedCount++;
        }
      }
      this.finalizeBulkWalletTxIngest(accountAddress);
    }

    // When the chain tip hasn't moved, incremental block scan does nothing. Still reconcile via
    // address index so we recover txs that appeared after an empty first-page backfill or indexer lag.
    if (heights.length === 0) {
      const reconcile = await this.ingestNockblocksTransactionsByAddress(
        accountAddress,
        ownFirstNames,
        client,
        { maxPages: 50, assertCurrent: opts?.assertCurrent }
      );
      syncedCount += reconcile.ingested;
    }

    this.setAccountSyncState(accountAddress, {
      historyInitialized: true,
      lastHistorySyncedTip: tip.height,
      lastSyncedHeight: Math.max(syncState.lastSyncedHeight, tip.height),
    });
    opts?.assertCurrent?.();
    await this.saveAccountData();
    opts?.assertCurrent?.();

    return syncedCount;
  }

  /**
   * Run Nockblocks mempool + confirmed-history ingest for this account.
   * Must be awaited after UTXO sync: MV3 service workers can terminate as soon as the
   * SYNC_UTXOS handler returns; fire-and-forget left history stuck after `getTip` only.
   */
  private async refreshNockblocksHistoryAfterUtxoSync(
    accountAddress: string,
    opts?: { retryAddressIndexOnEmptyPage?: boolean; assertCurrent?: () => void }
  ): Promise<void> {
    if (!isNockblocksConfigured()) {
      return;
    }

    await this.enqueueNockblocksHistoryRefresh(accountAddress, async () => {
      try {
        opts?.assertCurrent?.();
        await this.refreshPendingTransactionStatuses(accountAddress, opts?.assertCurrent);
        opts?.assertCurrent?.();
        await this.syncConfirmedHistory(accountAddress, opts);
        opts?.assertCurrent?.();
      } catch (error) {
        // Lifecycle invalidation must abort the parent sync, not be downgraded
        // to an optional indexer warning.
        opts?.assertCurrent?.();
        console.warn('[Vault] Nockblocks history refresh failed:', error);
      }
    });
  }

  /**
   * Sync UTXOs for a single account with chain state
   * This uses the encrypted in-memory UTXO store
   *
   * @param accountAddress - Account to sync
   * @returns Summary of what changed
   */
  async syncAccountUTXOs(
    accountAddress: string,
    options: { skipHistory?: boolean } = {}
  ): Promise<{
    newIncoming: number;
    newChange: number;
    spent: number;
    confirmed: number;
    expired: number;
  }> {
    if (this.state.locked) {
      throw new Error('Vault is locked');
    }
    const syncLifecycleEpoch = this.accountDataEpoch;
    this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

    const syncConfig = await getEffectiveRpcConfig();
    this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
    const syncNetworkIdentity = getRpcNetworkIdentity(syncConfig);
    const rpcClient = createBrowserClient(syncConfig.rpcUrl);

    const syncResult = await withAccountLock(accountAddress, async () => {
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      // 1. Fetch current UTXOs from chain
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      const blockHeight = balanceResult.blockHeight;
      const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
      const fetchedUTXOs = chainNotes.map(n => this.noteToFetchedUTXO(n));

      // Never apply data fetched from an endpoint after settings have moved to
      // another network. If settings change immediately after this check, the
      // old identity remains attached and subsequent builds still fail closed.
      const currentNetworkIdentity = getRpcNetworkIdentity(await getEffectiveRpcConfig());
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      if (currentNetworkIdentity !== syncNetworkIdentity) {
        throw new Error('RPC network changed during sync; sync again');
      }

      const priorSyncState = this.getAccountSyncState(accountAddress);
      const legacyDefaultNetwork =
        priorSyncState.rpcNetworkIdentity === undefined &&
        syncNetworkIdentity === getRpcNetworkIdentity(defaultRpcConfig);
      if (priorSyncState.rpcNetworkIdentity !== syncNetworkIdentity && !legacyDefaultNetwork) {
        const transactions = this.getWalletTransactions(accountAddress);
        const nonterminalTransactions = transactions.filter(
          tx =>
            tx.status === 'created' ||
            tx.status === 'broadcast_pending' ||
            tx.status === 'mempool_seen' ||
            tx.status === 'broadcasted_unconfirmed'
        );
        const provablyUnsubmittedIds = new Set(
          nonterminalTransactions
            .filter(
              tx =>
                tx.status === 'created' &&
                Boolean(tx.exactIntentId || tx.locallyManagedSubmission) &&
                !tx.txHash &&
                !tx.trackingTxId
            )
            .map(tx => tx.id)
        );
        const hasAmbiguousTransaction = nonterminalTransactions.some(
          tx => !provablyUnsubmittedIds.has(tx.id)
        );
        const hasAmbiguousReservation = this.getAccountNotes(accountAddress).some(
          note =>
            note.state === 'in_flight' &&
            (!note.pendingTxId || !provablyUnsubmittedIds.has(note.pendingTxId))
        );
        if (hasAmbiguousTransaction || hasAmbiguousReservation) {
          throw new Error(
            'This account has a transaction pending on the previously selected network; switch back before changing networks'
          );
        }

        // A legacy or different-network cache cannot be diffed against this
        // endpoint: doing so could falsely confirm transactions or reserve old
        // notes. Install a fresh snapshot in one encrypted write instead.
        const replacementNotes = fetchedUTXOs.map(note =>
          fetchedToStoredNote(note, accountAddress, 'available')
        );
        const previousVersion = this.utxoStore[accountAddress]?.version ?? 0;
        this.utxoStore[accountAddress] = {
          notes: replacementNotes,
          version: previousVersion + 1,
          blockHeight,
        };
        for (const transaction of transactions) {
          // Preserve terminal history byte-for-byte. The sync-state flag below
          // keeps those old-network records out of future change matching.
          if (provablyUnsubmittedIds.has(transaction.id)) {
            transaction.status = 'failed';
            transaction.updatedAt = Date.now();
          }
        }
        this.cachedBalances[accountAddress] = balanceResult.totalNock;
        await this.persistCompletedAccountSync(accountAddress, {
          rpcNetworkIdentity: syncNetworkIdentity,
          excludeTerminalHistoryFromChangeDetection: true,
          lastSyncedHeight: blockHeight,
        });
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
        return {
          newIncoming: 0,
          newChange: 0,
          spent: 0,
          confirmed: 0,
          expired: 0,
        };
      }

      // If this multi-write reconciliation is interrupted, builds must not use
      // the partial snapshot. The final height/provenance commit clears it.
      this.setAccountSyncState(accountAddress, { utxoSyncInProgress: true });
      await this.saveAccountData();
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

      // 2. Get local state (from in-memory encrypted store)
      const localNotes = this.getAccountNotes(accountAddress);
      const releasedOrphanReservations = releaseUnownedOnChainReservations(
        localNotes,
        this.getWalletTransactions(accountAddress),
        accountAddress,
        new Set(fetchedUTXOs.map(note => note.noteId))
      );
      if (releasedOrphanReservations > 0 && this.utxoStore[accountAddress]) {
        this.utxoStore[accountAddress].version += 1;
        await this.saveAccountData();
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      }
      const pendingTxs = this.getPendingOutgoingTransactions(accountAddress);
      const allOutgoingTxs = priorSyncState.excludeTerminalHistoryFromChangeDetection
        ? pendingTxs
        : this.getAllOutgoingTransactions(accountAddress);

      // 3. Compute diff (pass all outgoing txs for change detection)
      const diff = computeUTXODiff(localNotes, fetchedUTXOs, pendingTxs, allOutgoingTxs);

      // 4. Process spent notes
      if (diff.nowSpent.length > 0) {
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
        const spentNoteIds = diff.nowSpent.map(n => n.noteId);
        await this.markNotesSpent(accountAddress, spentNoteIds);
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

        // Check if any pending transactions are now confirmed
        for (const tx of pendingTxs) {
          this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
          if (areTransactionInputsSpent(tx, diff.nowSpent)) {
            // Find change outputs for this transaction
            const changeNoteIds = matchChangeOutputs(tx, diff.newUTXOs, diff.isChangeMap);

            await this.updateWalletTransaction(accountAddress, tx.id, {
              status: 'confirmed',
              expectedChangeNoteIds: changeNoteIds,
              confirmationSource: tx.confirmationSource || 'utxo_fallback',
            });
            this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
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
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
        await this.saveNotes(accountAddress, newStoredNotes, blockHeight);
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
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
          this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
          if (!tx.inputNoteIds || tx.inputNoteIds.length === 0) continue;

          const allInputsSpent = tx.inputNoteIds.every(noteId => spentNoteIds.has(noteId));

          if (allInputsSpent) {
            await this.updateWalletTransaction(accountAddress, tx.id, {
              status: 'confirmed',
              confirmationSource: tx.confirmationSource || 'utxo_fallback',
            });
            this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
            confirmedFromPreviousSpent++;
          }
        }
      }

      // 6. Handle expired transactions
      const allTxs = this.getWalletTransactions(accountAddress);
      const expiredTxs = findExpiredTransactions(allTxs, Vault.TX_EXPIRY_MS);

      for (const expiredTx of expiredTxs) {
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
        if (expiredTx.inputNoteIds && expiredTx.inputNoteIds.length > 0) {
          await this.releaseInFlightNotes(accountAddress, expiredTx.inputNoteIds, expiredTx.id);
          this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
        }

        await this.updateWalletTransaction(accountAddress, expiredTx.id, {
          status: 'expired',
        });
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      }

      // 7. Handle failed transactions
      const failedTxs = findFailedTransactions(allTxs, currentNotes);

      for (const failedTx of failedTxs) {
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
        if (failedTx.inputNoteIds && failedTx.inputNoteIds.length > 0) {
          await this.releaseInFlightNotes(accountAddress, failedTx.inputNoteIds, failedTx.id);
          this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
        }

        await this.updateWalletTransaction(accountAddress, failedTx.id, {
          status: 'failed',
        });
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      }

      // 8. Cleanup old spent notes to prevent storage bloat
      await this.removeSpentNotes(accountAddress);
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

      const confirmedFromNewSpent = pendingTxs.filter(tx =>
        areTransactionInputsSpent(tx, diff.nowSpent)
      ).length;

      // Persist provenance and tip even when the chain returned no new notes.
      if (!this.utxoStore[accountAddress]) {
        this.utxoStore[accountAddress] = { notes: [], version: 0, blockHeight };
      } else if (this.utxoStore[accountAddress].blockHeight !== blockHeight) {
        this.utxoStore[accountAddress].blockHeight = blockHeight;
        this.utxoStore[accountAddress].version += 1;
      }
      if (getRpcNetworkIdentity(await getEffectiveRpcConfig()) !== syncNetworkIdentity) {
        throw new Error('RPC network changed during sync; sync again');
      }
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      await this.persistCompletedAccountSync(accountAddress, {
        rpcNetworkIdentity: syncNetworkIdentity,
        lastSyncedHeight: Math.max(priorSyncState.lastSyncedHeight, blockHeight),
      });
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

      return {
        newIncoming,
        newChange,
        spent: diff.nowSpent.length,
        confirmed: confirmedFromNewSpent + confirmedFromPreviousSpent,
        expired: expiredTxs.length,
      };
    });

    if (options.skipHistory) return syncResult;

    // Await outside account lock (slow Nockblocks I/O). Must complete before returning
    // from sync so the MV3 service worker stays alive until history is ingested.
    this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
    const hasLocalNotes = this.getAccountNotes(accountAddress).length > 0;
    await this.refreshNockblocksHistoryAfterUtxoSync(accountAddress, {
      retryAddressIndexOnEmptyPage: hasLocalNotes,
      assertCurrent: () => this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch),
    });
    return syncResult;
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
    const syncLifecycleEpoch = this.accountDataEpoch;
    this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

    const syncConfig = await getEffectiveRpcConfig();
    this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
    const syncNetworkIdentity = getRpcNetworkIdentity(syncConfig);
    const rpcClient = createBrowserClient(syncConfig.rpcUrl);

    return withAccountLock(accountAddress, async () => {
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      // Check if already initialized
      const existingNotes = this.getAccountNotes(accountAddress);
      if (
        existingNotes.length > 0 &&
        this.getAccountSyncState(accountAddress).rpcNetworkIdentity === syncNetworkIdentity
      ) {
        return;
      }

      // Fetch current UTXOs from chain
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      const blockHeight = balanceResult.blockHeight;
      const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
      if (getRpcNetworkIdentity(await getEffectiveRpcConfig()) !== syncNetworkIdentity) {
        throw new Error('RPC network changed during sync; sync again');
      }
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      this.setAccountSyncState(accountAddress, { utxoSyncInProgress: true });
      await this.saveAccountData();
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

      // Convert to stored notes (all available, no incoming tx records on first init)
      const storedNotes: StoredNote[] = chainNotes.map(note =>
        noteToStoredNote(note, accountAddress, 'available')
      );

      this.setAccountSyncState(accountAddress, {
        rpcNetworkIdentity: syncNetworkIdentity,
        utxoSyncInProgress: false,
      });
      try {
        await this.replaceAccountNotes(accountAddress, storedNotes, blockHeight);
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      } catch (error) {
        this.setAccountSyncState(accountAddress, { utxoSyncInProgress: true });
        throw error;
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
    const syncLifecycleEpoch = this.accountDataEpoch;
    this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

    const syncConfig = await getEffectiveRpcConfig();
    this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
    const syncNetworkIdentity = getRpcNetworkIdentity(syncConfig);
    const rpcClient = createBrowserClient(syncConfig.rpcUrl);

    return withAccountLock(accountAddress, async () => {
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      // Fetch current UTXOs from chain (first-name only)
      const balanceResult = await queryV1Balance(accountAddress, rpcClient);
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      const blockHeight = balanceResult.blockHeight;
      const chainNotes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];
      const fetchedUTXOs = chainNotes.map(n => this.noteToFetchedUTXO(n));
      if (getRpcNetworkIdentity(await getEffectiveRpcConfig()) !== syncNetworkIdentity) {
        throw new Error('RPC network changed during sync; sync again');
      }
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      this.setAccountSyncState(accountAddress, { utxoSyncInProgress: true });
      await this.saveAccountData();
      this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);

      // Get existing notes to preserve pending state
      const existingNotes = this.getAccountNotes(accountAddress);
      releaseUnownedOnChainReservations(
        existingNotes,
        this.getWalletTransactions(accountAddress),
        accountAddress,
        new Set(fetchedUTXOs.map(note => note.noteId))
      );

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
      this.setAccountSyncState(accountAddress, {
        rpcNetworkIdentity: syncNetworkIdentity,
        utxoSyncInProgress: false,
      });
      try {
        await this.replaceAccountNotes(accountAddress, newStoredNotes, blockHeight);
        this.assertAccountOperationCurrent(accountAddress, syncLifecycleEpoch);
      } catch (error) {
        this.setAccountSyncState(accountAddress, { utxoSyncInProgress: true });
        throw error;
      }
    });
  }

  /**
   * For one mnemonic seed: scan slip10 indices 1..MAX_SUBWALLET_DISCOVERY_SCAN for on-chain
   * balance, then ensure an account exists for every index from 1 through the highest index that
   * has funds (fills gaps).
   */
  async discoverAndEnsureSubwalletsForSeed(
    seedAccountId: string
  ): Promise<{ ok: true; added: number } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const seedAccount = this.seedAccounts.find(s => s.id === seedAccountId);
    if (!seedAccount || seedAccount.type !== 'mnemonic' || !seedAccount.mnemonic) {
      return { ok: true, added: 0 };
    }
    const mnemonic = seedAccount.mnemonic;

    const masterForSeed = seedAccount.accounts.find(a => a.index === 0);
    if (!masterForSeed || masterForSeed.hidden) {
      return { ok: true, added: 0 };
    }
    const discoveryLifecycleEpoch = this.accountDataEpoch;
    const assertDiscoveryCurrent = () =>
      this.assertAccountOperationCurrent(masterForSeed.address, discoveryLifecycleEpoch);

    await initWasmModules();
    assertDiscoveryCurrent();
    const endpoint = await getEffectiveRpcEndpoint();
    assertDiscoveryCurrent();
    const rpcClient = createBrowserClient(endpoint);

    const seedOrdinal = this.getSeedOrdinal(seedAccount.id);
    // Keep balances found during the scan so we can seed cachedBalances for
    // freshly-added sub-wallets.
    const discoveredAddressByIndex = new Map<number, string>();
    const discoveredBalanceByIndex = new Map<number, number>();

    let lastWithBalance = 0;
    let nextIndexToScan = 1;
    let scanThroughIndex = MAX_SUBWALLET_DISCOVERY_SCAN;
    const maxScanIndex = 35;
    const discoveryQueryConcurrency = 3;

    const queryDiscoveryIndex = async (index: number) => {
      const address = await deriveAddress(mnemonic, index);
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const balanceResult = await queryV1Balance(address, rpcClient);
          return { index, address, balance: balanceResult.totalNock };
        } catch (error) {
          lastError = error;
          if (attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    while (nextIndexToScan <= scanThroughIndex && nextIndexToScan <= maxScanIndex) {
      const startIndex = nextIndexToScan;
      const endIndex = Math.min(scanThroughIndex, maxScanIndex);
      nextIndexToScan = endIndex + 1;

      const indexes = Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => {
        return startIndex + offset;
      });
      const discoveryResults: PromiseSettledResult<{
        index: number;
        address: string;
        balance: number;
      }>[] = [];
      for (let i = 0; i < indexes.length; i += discoveryQueryConcurrency) {
        discoveryResults.push(
          ...(await Promise.allSettled(
            indexes.slice(i, i + discoveryQueryConcurrency).map(queryDiscoveryIndex)
          ))
        );
        assertDiscoveryCurrent();
      }

      for (const result of discoveryResults) {
        if (result.status !== 'fulfilled') {
          console.warn('[Vault] Sub-wallet discovery balance query failed:', result.reason);
          continue;
        }

        const { index, address, balance } = result.value;
        discoveredAddressByIndex.set(index, address);
        if (balance > 0) {
          lastWithBalance = Math.max(lastWithBalance, index);
          scanThroughIndex = Math.max(
            scanThroughIndex,
            Math.min(lastWithBalance + MAX_SUBWALLET_DISCOVERY_SCAN, maxScanIndex)
          );
          discoveredBalanceByIndex.set(index, balance);
        }
      }
    }

    const existingIndices = new Set(seedAccount.accounts.map(a => a.index));
    let added = 0;

    for (let j = 1; j <= lastWithBalance; j++) {
      assertDiscoveryCurrent();
      if (existingIndices.has(j)) continue;

      const { iconStyleId, iconColor } = this.pickUnusedStyleGlobally();
      const address = discoveredAddressByIndex.get(j) ?? (await deriveAddress(mnemonic, j));
      assertDiscoveryCurrent();
      const newAccount: SubAccount = {
        name: this.getDefaultChildWalletName(seedOrdinal, j),
        address,
        index: j,
        iconStyleId,
        iconColor,
        createdAt: Date.now(),
      };
      seedAccount.accounts.push(newAccount);
      existingIndices.add(j);
      added++;
    }

    if (added > 0) {
      assertDiscoveryCurrent();
      seedAccount.accounts.sort((a, b) => a.index - b.index);
      this.rebuildFlatAccounts();

      // Seed cachedBalances for the newly added accounts so the dropdown shows
      // the right number immediately
      const merged = { ...this.cachedBalances };
      for (const [idx, balance] of discoveredBalanceByIndex) {
        const addr = discoveredAddressByIndex.get(idx);
        if (addr) merged[addr] = balance;
      }
      this.cachedBalances = merged;

      await this.saveAccountsToVault();
      assertDiscoveryCurrent();
      await this.saveAccountData();
      assertDiscoveryCurrent();
    }

    return { ok: true, added };
  }

  /**
   * Creates a child sub-account under the specified seed source.
   */
  async createChildAccount(
    seedAccountId?: string,
    name?: string
  ): Promise<{ account: SubAccount } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    const seedAccount = seedAccountId
      ? this.seedAccounts.find(seed => seed.id === seedAccountId) || null
      : this.getSeedAccountForWallet(currentAccount);
    if (!seedAccount || seedAccount.type !== 'mnemonic' || !seedAccount.mnemonic) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    const masterForSeed = seedAccount.accounts.find(a => a.index === 0);
    if (!masterForSeed || masterForSeed.hidden) {
      return { error: ERROR_CODES.MASTER_WALLET_HIDDEN };
    }

    const hiddenSubs = seedAccount.accounts
      .filter(a => a.index > 0 && a.hidden)
      .sort((a, b) => a.index - b.index);
    if (hiddenSubs.length > 0) {
      const toRestore = hiddenSubs[0];
      toRestore.hidden = false;
      this.rebuildFlatAccounts();
      await this.saveAccountsToVault();
      return { account: toRestore };
    }

    const indices = seedAccount.accounts.map(a => a.index);
    const nextIndex = Math.max(0, ...indices) + 1;

    const seedOrdinal = this.getSeedOrdinal(seedAccount.id);
    const trimmedName = name?.trim();
    const accountName = trimmedName || this.getDefaultChildWalletName(seedOrdinal, nextIndex);

    const { iconStyleId, iconColor } = this.pickUnusedStyleGlobally();

    const newAccount: SubAccount = {
      name: accountName,
      address: await deriveAddress(seedAccount.mnemonic, nextIndex),
      index: nextIndex,
      iconStyleId,
      iconColor,
      createdAt: Date.now(),
    };

    seedAccount.accounts.push(newAccount);
    seedAccount.accounts.sort((a, b) => a.index - b.index);
    this.rebuildFlatAccounts();

    await this.saveAccountsToVault();

    return { account: newAccount };
  }

  /**
   * Switch current account by address
   */
  async switchAccount(
    address: string
  ): Promise<
    { ok: boolean; account: SubAccount; activeSeedSourceId: string | null } | { error: string }
  > {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const index = this.state.accounts.findIndex(acc => acc.address === address);
    if (index < 0) {
      return { error: ERROR_CODES.BAD_ADDRESS };
    }

    if (this.state.accounts[index].hidden) {
      return { error: ERROR_CODES.ACCOUNT_HIDDEN };
    }

    this.state.currentAccountIndex = index;
    this.mnemonic = this.getSigningMnemonicForCurrentAccount();

    await chrome.storage.local.set({
      [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: index,
    });

    return {
      ok: true,
      account: this.state.accounts[index],
      activeSeedSourceId: this.getActiveSeedSourceId(),
    };
  }

  /**
   * Renames an account
   */
  async renameAccount(address: string, name: string): Promise<{ ok: boolean } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const index = this.state.accounts.findIndex(acc => acc.address === address);
    if (index < 0) {
      return { error: ERROR_CODES.BAD_ADDRESS };
    }

    const account = this.state.accounts[index];
    account.name = name;

    if (account.index === 0) {
      const seedAccount = this.getSeedAccountForWallet(account);
      if (seedAccount) {
        seedAccount.name = name;
      }
    }

    // Save accounts to encrypted vault
    await this.saveAccountsToVault();

    return { ok: true };
  }

  /**
   * Updates account styling (icon and color)
   */
  async updateAccountStyling(
    address: string,
    iconStyleId: number | string,
    iconColor: string
  ): Promise<{ ok: boolean } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const index = this.state.accounts.findIndex(acc => acc.address === address);
    if (index < 0) {
      return { error: ERROR_CODES.BAD_ADDRESS };
    }

    this.state.accounts[index].iconStyleId = normalizeIconStyleId(iconStyleId);
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
    address: string
  ): Promise<{ ok: boolean; switchedTo?: string } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const index = this.state.accounts.findIndex(acc => acc.address === address);
    if (index < 0) {
      return { error: ERROR_CODES.BAD_ADDRESS };
    }

    const accountToHide = this.state.accounts[index];

    // When hiding a master account (index 0), collect all sibling sub-accounts
    // from the same seed source so they are hidden together.
    const seedForAccount = this.getSeedAccountForWallet(accountToHide);
    const siblingAddresses =
      accountToHide.index === 0 && seedForAccount
        ? new Set(seedForAccount.accounts.map(a => a.address))
        : new Set<string>();

    // All accounts that will become hidden (the target + any siblings)
    const addressesToHide = new Set([address, ...siblingAddresses]);

    // Check that hiding all of them won't leave zero visible accounts
    const visibleAccounts = this.state.accounts.filter(acc => !acc.hidden);
    const remainingVisible = visibleAccounts.filter(acc => !addressesToHide.has(acc.address));
    if (remainingVisible.length === 0) {
      return { error: ERROR_CODES.CANNOT_HIDE_LAST_ACCOUNT };
    }

    // Mark the target and all siblings as hidden
    for (const acc of this.state.accounts) {
      if (addressesToHide.has(acc.address)) {
        acc.hidden = true;
      }
    }

    let switchedTo: string | undefined;

    // If the current account was among those hidden, switch to first still-visible account
    const currentAddress = this.state.accounts[this.state.currentAccountIndex]?.address;
    if (currentAddress && addressesToHide.has(currentAddress)) {
      const firstVisibleIndex = this.state.accounts.findIndex(acc => !acc.hidden);
      if (firstVisibleIndex !== -1) {
        this.state.currentAccountIndex = firstVisibleIndex;
        this.mnemonic = this.getSigningMnemonicForCurrentAccount();
        switchedTo = this.state.accounts[firstVisibleIndex].address;
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

      // Parse payload and return the mnemonic for the currently selected seed source
      const decoded = this.decodeVaultPayload(pt);
      const currentAccount = this.getCurrentAccount();
      const selectedSeed = currentAccount
        ? decoded.seedAccounts.find(seed =>
            seed.accounts.some(a => a.address === currentAccount.address)
          )
        : decoded.seedAccounts.find(seed => seed.type === 'mnemonic');

      if (!selectedSeed || selectedSeed.type !== 'mnemonic' || !selectedSeed.mnemonic) {
        return { error: 'Selected account has no mnemonic (external account source).' };
      }

      return { ok: true, mnemonic: selectedSeed.mnemonic };
    } catch (err) {
      return { error: ERROR_CODES.BAD_PASSWORD };
    }
  }

  /**
   * Signs a message using Nockchain WASM cryptography
   * Derives the account's private key and signs the message digest
   * @returns Canonical API v1 signature response
   */
  async signMessage(params: unknown, accountAddress?: string): Promise<SignMessageResponse> {
    if (this.state.locked) {
      throw new Error('Wallet is locked');
    }

    const msg = (Array.isArray(params) ? params[0] : params) ?? '';
    const msgString = String(msg);

    // Capture and bind the account before the first await so a concurrent account
    // switch cannot change which key signs an already-approved message.
    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      throw new Error('No account selected');
    }
    if (accountAddress && currentAccount.address !== accountAddress) {
      throw new Error('Signing account changed after approval');
    }
    const signingLifecycleEpoch = this.accountDataEpoch;
    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      throw new Error('Current account is external and cannot sign locally');
    }

    // Initialize WASM modules
    await initWasmModules();
    if (
      this.state.locked ||
      this.accountDataEpoch !== signingLifecycleEpoch ||
      this.getCurrentAccount()?.address !== currentAccount.address
    ) {
      throw new Error('Signing account changed after approval');
    }

    // Derive the account's private key based on derivation method
    const masterKey = wasm.deriveMasterKeyFromMnemonic(signingMnemonic, '');
    // Use the account's own index, not currentAccountIndex (accounts may be reordered)
    const childIndex = currentAccount.index;
    const accountKey = this.isMasterAccount(currentAccount)
      ? masterKey // Use master key directly for master-derived accounts
      : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

    if (!accountKey.privateKey || !accountKey.publicKey) {
      if (!this.isMasterAccount(currentAccount)) {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Cannot sign: no private key available');
    }

    // Sign: WASM expects 32-byte private key; copy to avoid view-into-WASM-memory issues
    const pk = accountKey.privateKey;
    if (pk.byteLength !== 32) {
      if (!this.isMasterAccount(currentAccount)) {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Invalid private key length for signing');
    }
    const signingKeyBytes = new Uint8Array(pk.slice(0, 32));
    const signature = wasm.signMessage(signingKeyBytes, msgString);

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

    const publicKeyHex = Array.from(accountKey.publicKey as Uint8Array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const publicKey = wasm.publicKeyFromHex(publicKeyHex);
    if (!publicKey) {
      if (!this.isMasterAccount(currentAccount)) {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Invalid public key');
    }

    // Signature is plain data in new API; no explicit free needed.
    if (!this.isMasterAccount(currentAccount)) {
      accountKey.free();
    }
    masterKey.free();

    return {
      signature,
      publicKey,
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
    if (this.state.locked) {
      throw new Error('Wallet is locked');
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      throw new Error('No account selected');
    }

    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      throw new Error('Current account is external and cannot sign locally');
    }

    // Initialize WASM modules
    await initWasmModules();

    // Derive the account's private and public keys based on derivation method
    const masterKey = wasm.deriveMasterKeyFromMnemonic(signingMnemonic, '');
    // Use the account's own index, not currentAccountIndex (accounts may be reordered)
    const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
    const accountKey = this.isMasterAccount(currentAccount)
      ? masterKey // Use master key directly for master-derived accounts
      : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

    if (!accountKey.privateKey || !accountKey.publicKey) {
      if (!this.isMasterAccount(currentAccount)) {
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
      if (!this.isMasterAccount(currentAccount)) {
        accountKey.free();
      }
      masterKey.free();
    }
  }

  /**
   * Build a complete unsigned V1 payment snapshot without reserving inputs,
   * writing history, or deriving private key material.
   */
  async buildSimpleTransaction(
    to: string,
    amount: Nicks,
    fee?: Nicks
  ): Promise<BuiltSimpleTransactionWithContext | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const capturedAccount = this.getCurrentAccount();
    if (!capturedAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }
    const capturedLifecycleEpoch = this.accountDataEpoch;
    try {
      return await withAccountLock(capturedAccount.address, async () => {
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== capturedAccount.address
        ) {
          throw new Error('Selected account changed while transaction was being built');
        }

        await initWasmModules();

        const blockHeight = this.getAccountBlockHeight(capturedAccount.address);
        const transactionContext = await getTransactionContextSnapshot(blockHeight);
        this.assertAccountSyncedForNetwork(
          capturedAccount.address,
          transactionContext.networkIdentity
        );

        const availableStoredNotes = this.getAvailableNotes(capturedAccount.address);
        if (availableStoredNotes.length === 0) {
          throw new Error('No available UTXOs.');
        }

        // Supply all available notes to WASM and reconcile the exact subset it
        // commits in the resulting transaction. The wallet, never the dApp,
        // chooses inputs and always sends change back to this account.
        const candidates = [...availableStoredNotes].sort((a, b) => b.assets - a.assets);
        const constructedTx = await buildUnsignedMultiNotePayment(
          candidates.map(convertStoredNoteForTxBuilder),
          to,
          amount,
          capturedAccount.address,
          fee,
          capturedAccount.address,
          blockHeight,
          transactionContext
        );

        if (
          constructedTx.nockchainTx.version !== 1 ||
          !guard.isNockchainTx(constructedTx.nockchainTx)
        ) {
          throw new Error('Simple transactions must use the V1 transaction format');
        }
        const rawTx = wasm.nockchainTxToRawTx(constructedTx.nockchainTx);
        if (!guard.isRawTxV1(rawTx)) {
          throw new Error('Simple transactions must use the V1 transaction format');
        }

        const builtInputNoteIds = wasm
          .rawTxInputNames(rawTx)
          .map(name => generateNoteId(String(name.first), String(name.last)));
        const builtSelection = resolveBuiltInputSelection(candidates, builtInputNoteIds);
        const candidatesById = new Map(candidates.map(note => [note.noteId, note]));
        const selectedNativeNotes = builtSelection.inputNoteIds.map(noteId => {
          const storedNote = candidatesById.get(noteId);
          if (!storedNote?.protoNote) {
            throw new Error('Selected input is missing its native note data');
          }
          const nativeNote = wasm.noteFromProtobuf(storedNote.protoNote);
          if (!guard.isNoteV1(nativeNote)) {
            throw new Error('Simple transactions require V1 input notes');
          }
          return nativeNote;
        });

        const outputs = wasm.rawTxOutputs(rawTx, blockHeight, transactionContext.txEngineSettings);
        if (outputs.some(output => !guard.isNoteV1(output))) {
          throw new Error('Simple transactions require V1 output notes');
        }

        const actualAmounts = resolveBuiltTransactionAmounts(
          builtSelection.selectedTotal,
          amount,
          constructedTx.feeUsed
        );
        const intentId = String(wasm.spendsV1Hash(constructedTx.nockchainTx.spends)) as Digest;

        // Async WASM/config work can outlive an account switch or lock. Fail
        // closed before returning note-level wallet data to the caller.
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== capturedAccount.address
        ) {
          throw new Error('Selected account changed while transaction was being built');
        }
        const currentTransactionContext = await getTransactionContextSnapshot(blockHeight);
        if (currentTransactionContext.fingerprint !== transactionContext.fingerprint) {
          throw new Error('Transaction network settings changed while the transaction was built');
        }
        this.assertAccountSyncedForNetwork(
          capturedAccount.address,
          currentTransactionContext.networkIdentity
        );
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== capturedAccount.address
        ) {
          throw new Error('Selected account changed while transaction was being built');
        }

        return {
          tx: constructedTx.nockchainTx,
          notes: selectedNativeNotes,
          outputs,
          intentId,
          accountAddress: capturedAccount.address as Digest,
          blockHeight,
          to: to as Digest,
          amount,
          inputTotal: String(builtSelection.selectedTotal) as Nicks,
          fee: String(actualAmounts.fee) as Nicks,
          minimumFee: String(constructedTx.minimumFee) as Nicks,
          change: String(actualAmounts.expectedChange) as Nicks,
          transactionContext,
        };
      });
    } catch (error) {
      console.error('[Vault] Unsigned transaction build failed:', error);
      return { error: feeEstimateUserFacingError(error, 'build') };
    }
  }

  /** Legacy wallet-UI projection; the public SDK now owns the build primitive. */
  async estimateTransactionFee(
    to: string,
    amount: Nicks
  ): Promise<{ fee: number } | { error: string }> {
    const result = await this.buildSimpleTransaction(to, amount);
    return 'error' in result ? result : { fee: Number(result.fee) };
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
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }
    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      return { error: 'Current account is external and cannot sign locally' };
    }
    try {
      // Initialize WASM modules
      await initWasmModules();

      // Derive keys
      const masterKey = wasm.deriveMasterKeyFromMnemonic(signingMnemonic, '');
      const childIndex = currentAccount.index ?? this.state.currentAccountIndex;
      const accountKey = this.isMasterAccount(currentAccount)
        ? masterKey
        : masterKey.deriveChild(childIndex);

      if (!accountKey.privateKey || !accountKey.publicKey) {
        if (!this.isMasterAccount(currentAccount)) {
          accountKey.free();
        }
        masterKey.free();
        return { error: 'Cannot estimate max: keys unavailable' };
      }

      const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

      try {
        // Get available (not in-flight) notes from in-memory UTXO store
        const blockHeight = this.getAccountBlockHeight(currentAccount.address);
        const transactionContext = await getTransactionContextSnapshot(blockHeight);
        this.assertAccountSyncedForNetwork(
          currentAccount.address,
          transactionContext.networkIdentity
        );
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
          String(estimationAmount) as Nicks,
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
        if (!this.isMasterAccount(currentAccount)) {
          accountKey.free();
        }
        masterKey.free();
      }
    } catch (error) {
      console.error('[Vault] Max send estimation failed:', error);
      return { error: feeEstimateUserFacingError(error, 'max') };
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
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }
    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      return { error: 'Current account is external and cannot sign locally' };
    }

    try {
      // Initialize WASM modules
      await initWasmModules();

      // Derive the account's private and public keys based on derivation method
      const masterKey = wasm.deriveMasterKeyFromMnemonic(signingMnemonic, '');
      // Use the account's own index, not currentAccountIndex (accounts may be reordered)
      const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
      const accountKey = this.isMasterAccount(currentAccount)
        ? masterKey // Use master key directly for master-derived accounts
        : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

      if (!accountKey.privateKey || !accountKey.publicKey) {
        if (!this.isMasterAccount(currentAccount)) {
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
        if (!this.isMasterAccount(currentAccount)) {
          accountKey.free();
        }
        masterKey.free();
      }
    } catch (error) {
      console.error('[Vault] Error sending transaction:', error);
      const rawMsg = error instanceof Error ? error.message : String(error);
      return {
        error: `Failed to send transaction: ${rewriteInsufficientFeeErrorToDecimalNock(rawMsg)}`,
      };
    }
  }

  /**
   * Reserve, sign, and broadcast the exact unsigned intent that was reviewed.
   * No replacement inputs are selected if the snapshot has gone stale.
   */
  async sendBuiltSimpleTransaction(
    build: BuiltSimpleTransaction,
    to: string,
    transactionContext: TransactionApprovalContext,
    origin: WalletTransaction['origin'] = 'provider_send',
    authorizationStillValid: () => boolean = () => true
  ): Promise<
    { txId: string; walletTx: WalletTransaction; broadcasted: boolean } | { error: string }
  > {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const capturedAccount = this.getCurrentAccount();
    if (!capturedAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }
    if (capturedAccount.address !== build.accountAddress) {
      return { error: 'Signing account changed after approval' };
    }
    if (to !== build.to) {
      return { error: 'Transaction recipient changed after approval' };
    }
    if (!this.getSigningMnemonicForCurrentAccount()) {
      return { error: 'Current account is external and cannot sign locally' };
    }
    const capturedLifecycleEpoch = this.accountDataEpoch;

    return withAccountLock(capturedAccount.address, async () => {
      const walletTxId = crypto.randomUUID();
      let selectedNoteIds: string[] = [];
      let notesReserved = false;
      let broadcastAttempted = false;
      let historyCreated = false;

      try {
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== build.accountAddress
        ) {
          throw new Error('Signing account changed after approval');
        }
        if (!authorizationStillValid()) {
          throw new Error('Request authorization changed after approval');
        }

        await initWasmModules();
        if (build.tx.version !== 1 || !guard.isNockchainTx(build.tx)) {
          throw new Error('Approved transaction is not a V1 transaction');
        }

        const rawTx = wasm.nockchainTxToRawTx(build.tx);
        if (!guard.isRawTxV1(rawTx)) {
          throw new Error('Approved transaction is not a V1 transaction');
        }
        assertMatchingTransactionIntent(build.intentId, String(wasm.spendsV1Hash(build.tx.spends)));
        if (String(wasm.rawTxTotalFees(rawTx)) !== build.fee) {
          throw new Error('Transaction fee changed after approval');
        }

        const builtInputNoteIds = wasm
          .rawTxInputNames(rawTx)
          .map(name => generateNoteId(String(name.first), String(name.last)));
        const availableNotes = this.getAvailableNotes(build.accountAddress);
        let builtSelection: ReturnType<typeof resolveBuiltInputSelection>;
        try {
          builtSelection = resolveBuiltInputSelection(availableNotes, builtInputNoteIds);
        } catch {
          throw new Error('Transaction inputs changed; rebuild required');
        }
        if (String(builtSelection.selectedTotal) !== build.inputTotal) {
          throw new Error('Transaction input values changed; rebuild required');
        }
        selectedNoteIds = builtSelection.inputNoteIds;

        const amounts = resolveBuiltTransactionAmounts(
          builtSelection.selectedTotal,
          build.amount,
          Number(build.fee)
        );
        if (String(amounts.fee) !== build.fee || String(amounts.expectedChange) !== build.change) {
          throw new Error('Transaction amounts changed after approval');
        }

        // Reject an already-stale approval before creating any reservation or
        // history. Height changes within one activation band remain valid.
        const currentHeight = this.getAccountBlockHeight(build.accountAddress);
        const preReservationContext = await getTransactionContextSnapshot(currentHeight);
        if (preReservationContext.fingerprint !== transactionContext.fingerprint) {
          throw new Error('Transaction network settings changed; rebuild required');
        }
        this.assertAccountSyncedForNetwork(
          build.accountAddress,
          transactionContext.networkIdentity
        );

        // Perform the final account/lock check immediately before the atomic
        // reservation. reserveAvailableNotes preflights every input first.
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== build.accountAddress
        ) {
          throw new Error('Signing account changed after approval');
        }
        if (!authorizationStillValid()) {
          throw new Error('Request authorization changed after approval');
        }
        const walletTx: WalletTransaction = {
          id: walletTxId,
          accountAddress: build.accountAddress,
          direction: 'outgoing',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'created',
          origin,
          exactIntentId: build.intentId,
          inputNoteIds: selectedNoteIds,
          recipient: to,
          amount: Number(build.amount),
          fee: Number(build.fee),
          expectedChange: Number(build.change),
        };
        await this.reserveNotesAndCreateWalletTransaction(
          build.accountAddress,
          selectedNoteIds,
          walletTx
        );
        notesReserved = true;
        historyCreated = true;

        // Re-evaluate after the durable reservation snapshot, then sign with
        // the settings captured by the reviewed build rather than refetching.
        const preSignHeight = this.getAccountBlockHeight(build.accountAddress);
        const preSignContext = await getTransactionContextSnapshot(preSignHeight);
        if (preSignContext.fingerprint !== transactionContext.fingerprint) {
          throw new Error('Transaction network settings changed; rebuild required');
        }
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== build.accountAddress
        ) {
          throw new Error('Signing account changed after approval');
        }
        if (!authorizationStillValid()) {
          throw new Error('Request authorization changed after approval');
        }

        const signedTx = await this.signRawTx({
          rawTx,
          blockHeight: build.blockHeight,
          accountAddress: build.accountAddress,
          txEngineSettings: transactionContext.txEngineSettings,
        });
        if (signedTx.version !== 1 || !guard.isNockchainTx(signedTx)) {
          throw new Error('Signed transaction is not a V1 transaction');
        }
        assertMatchingTransactionIntent(build.intentId, String(wasm.spendsV1Hash(signedTx.spends)));
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== build.accountAddress
        ) {
          throw new Error('Signing account changed after approval');
        }

        const signedRawTx = wasm.nockchainTxToRawTx(signedTx);
        if (!guard.isRawTxV1(signedRawTx)) {
          throw new Error('Signed transaction is not a V1 transaction');
        }
        if (String(wasm.rawTxTotalFees(signedRawTx)) !== build.fee) {
          throw new Error('Signed transaction fee does not match the approved transaction');
        }

        const protobufTx = wasm.rawTxToProtobuf(signedRawTx);
        const signedTxId = String(signedRawTx.id);
        walletTx.txHash = signedTxId;
        walletTx.trackingTxId = signedTxId;
        walletTx.status = 'broadcast_pending';
        await this.updateWalletTransaction(build.accountAddress, walletTxId, {
          txHash: signedTxId,
          trackingTxId: signedTxId,
          status: 'broadcast_pending',
        });

        // This is the final async check before submission. Construct the client
        // from this exact snapshot and do not refetch config after it succeeds.
        const rpcClient = createBrowserClient(transactionContext.rpcUrl);
        const liveHeight = await rpcClient.getCurrentBlockHeight();
        if (!Number.isSafeInteger(liveHeight) || liveHeight <= 0) {
          throw new Error('Could not verify the current network height; rebuild required');
        }
        const submissionContext = await getTransactionContextSnapshot(liveHeight);
        if (
          submissionContext.fingerprint !== transactionContext.fingerprint ||
          (submissionContext.nextTxEngineActivationHeight !== undefined &&
            submissionContext.nextTxEngineActivationHeight <= liveHeight + 1)
        ) {
          throw new Error('Transaction network settings changed; rebuild required');
        }
        if (
          this.state.locked ||
          this.accountDataEpoch !== capturedLifecycleEpoch ||
          this.getCurrentAccount()?.address !== build.accountAddress
        ) {
          throw new Error('Signing account changed after approval');
        }
        if (!authorizationStillValid()) {
          throw new Error('Request authorization changed after approval');
        }
        // Once submission begins, a network error is ambiguous: the node may
        // have accepted the transaction. Preserve reservations and pending
        // history so normal reconciliation can determine the outcome.
        broadcastAttempted = true;
        await rpcClient.sendTransaction(protobufTx);

        walletTx.status = 'broadcasted_unconfirmed';
        await this.updateWalletTransaction(build.accountAddress, walletTxId, {
          txHash: signedTxId,
          trackingTxId: signedTxId,
          status: 'broadcasted_unconfirmed',
          lastMempoolCheckAt: Date.now(),
          lastConfirmationCheckAt: 0,
        });

        return { txId: signedTxId, walletTx, broadcasted: true };
      } catch (error) {
        if (!broadcastAttempted && notesReserved && selectedNoteIds.length > 0) {
          try {
            if (historyCreated) {
              await this.failUnsubmittedExactTransaction(
                build.accountAddress,
                selectedNoteIds,
                walletTxId
              );
            } else {
              await this.releaseInFlightNotes(build.accountAddress, selectedNoteIds, walletTxId);
            }
          } catch (releaseError) {
            console.error('[Vault] Failed to release exact transaction inputs:', releaseError);
          }
        }

        const rawMsg = error instanceof Error ? error.message : String(error);
        return {
          error: broadcastAttempted
            ? `Transaction submission status is unknown: ${rewriteInsufficientFeeErrorToDecimalNock(rawMsg)}`
            : `Transaction failed: ${rewriteInsufficientFeeErrorToDecimalNock(rawMsg)}`,
        };
      }
    });
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
   * @param options.feeSelectionHint - Advisory fee used only to choose enough notes
   * @param options.accountAddress - Account bound to an external approval request
   * @returns Transaction result with txId and wallet transaction record
   */
  async sendTransactionV2(
    to: string,
    amount: Nicks,
    fee?: Nicks,
    sendMax?: boolean,
    priceUsdAtTime?: number,
    origin: WalletTransaction['origin'] = 'popup_send',
    options: SendTransactionV2Options = {}
  ): Promise<
    { txId: string; walletTx: WalletTransaction; broadcasted: boolean } | { error: string }
  > {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }
    if (options.accountAddress && currentAccount.address !== options.accountAddress) {
      return { error: 'Signing account changed after approval' };
    }
    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      return { error: 'Current account is external and cannot sign locally' };
    }
    const capturedLifecycleEpoch = this.accountDataEpoch;

    // Use account lock to prevent race conditions
    return withAccountLock(currentAccount.address, async () => {
      // Generate wallet transaction ID upfront
      const walletTxId = crypto.randomUUID();
      let selectedNoteIds: string[] = [];
      let notesReserved = false;
      let broadcastAttempted = false;

      try {
        // Initialize WASM modules
        await initWasmModules();

        // Derive keys
        const masterKey = wasm.deriveMasterKeyFromMnemonic(signingMnemonic, '');
        const childIndex = currentAccount.index ?? this.state.currentAccountIndex;
        const accountKey = this.isMasterAccount(currentAccount)
          ? masterKey
          : masterKey.deriveChild(childIndex);

        if (!accountKey.privateKey || !accountKey.publicKey) {
          if (!this.isMasterAccount(currentAccount)) {
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

          const transactionContext = await getTransactionContextSnapshot(blockHeight);
          this.assertAccountSyncedForNetwork(
            currentAccount.address,
            transactionContext.networkIdentity
          );
          if (
            this.state.locked ||
            this.accountDataEpoch !== capturedLifecycleEpoch ||
            this.getCurrentAccount()?.address !== currentAccount.address
          ) {
            throw new Error('Signing account changed while the transaction was prepared');
          }

          if (availableStoredNotes.length === 0) {
            return { error: 'No available UTXOs.' };
          }

          // 2. Choose enough notes using the exact override, an advisory estimate, or the
          // legacy fallback. Only `fee` is forwarded to WASM as an exact fee override.
          const amountNum = Number(amount);
          const selectionFeeNicks = fee ?? options.feeSelectionHint;
          const selectionFeeNum =
            selectionFeeNicks !== undefined ? Number(selectionFeeNicks) : 2 * NOCK_TO_NICKS;
          if (
            !Number.isSafeInteger(amountNum) ||
            amountNum < 0 ||
            !Number.isSafeInteger(selectionFeeNum) ||
            selectionFeeNum < 0
          ) {
            return { error: 'Amount or fee exceeds the supported Nicks range' };
          }

          let selectedStoredNotes: typeof availableStoredNotes;
          let expectedChange: number;

          if (sendMax) {
            // SEND MAX: Use ALL available UTXOs, no change back to sender
            selectedStoredNotes = availableStoredNotes;
            expectedChange = 0; // All goes to recipient (minus fee)
          } else {
            // NORMAL: Select only notes needed for amount + fee
            const targetAmount = amountNum + selectionFeeNum;
            if (!Number.isSafeInteger(targetAmount)) {
              return { error: 'Amount plus fee exceeds the supported Nicks range' };
            }
            const selected = selectNotesForAmount(availableStoredNotes, targetAmount);

            if (!selected) {
              return {
                error: `Insufficient available funds`,
              };
            }

            selectedStoredNotes = selected;
            const selectedTotal = selectedStoredNotes.reduce((sum, n) => sum + n.assets, 0);
            expectedChange = selectedTotal - amountNum - selectionFeeNum;
          }

          selectedNoteIds = selectedStoredNotes.map(n => n.noteId);
          const walletTx: WalletTransaction = {
            id: walletTxId,
            accountAddress: currentAccount.address,
            direction: 'outgoing',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            priceUsdAtTime,
            status: 'created',
            origin,
            locallyManagedSubmission: true,
            inputNoteIds: selectedNoteIds,
            recipient: to,
            amount: amountNum,
            fee: selectionFeeNum,
            expectedChange: expectedChange > 0 ? expectedChange : 0,
          };
          if (
            this.state.locked ||
            this.accountDataEpoch !== capturedLifecycleEpoch ||
            this.getCurrentAccount()?.address !== currentAccount.address
          ) {
            throw new Error('Signing account changed while the transaction was prepared');
          }
          // Reserve inputs and create their owner history atomically.
          await this.reserveNotesAndCreateWalletTransaction(
            currentAccount.address,
            selectedNoteIds,
            walletTx
          );
          notesReserved = true;

          // For sendMax: set refundPKH = recipient so all funds go to recipient (sweep)
          const refundAddress = sendMax ? to : undefined;

          // 6. Build with the approval estimate as a selection hint. If WASM's actual
          // fee needs more value, reserve the remaining locally-available notes and
          // retry once. Explicit-fee requests never take this path.
          const allowAdvisoryRetry =
            !sendMax && fee === undefined && options.feeSelectionHint !== undefined;
          const buildAttempt = await buildWithAdvisoryFeeRetry({
            initialCandidates: selectedStoredNotes,
            retryCandidates: allowAdvisoryRetry ? availableStoredNotes : selectedStoredNotes,
            allowRetry: allowAdvisoryRetry,
            beforeRetry: async retryCandidates => {
              const retryNoteIds = retryCandidates.map(note => note.noteId);
              const initiallyReserved = new Set(selectedNoteIds);
              const additionalNoteIds = retryNoteIds.filter(
                noteId => !initiallyReserved.has(noteId)
              );

              // Assign before awaiting so the outer failure path releases every note
              // even if persistence fails after partially reserving the retry set.
              selectedNoteIds = retryNoteIds;
              if (additionalNoteIds.length > 0) {
                await this.reserveAdditionalTransactionNotes(
                  currentAccount.address,
                  additionalNoteIds,
                  walletTxId
                );
              }
            },
            build: async candidates => {
              const txBuilderNotes = [...candidates]
                .sort((a, b) => b.assets - a.assets)
                .map(convertStoredNoteForTxBuilder);
              return await buildMultiNotePayment(
                txBuilderNotes,
                to,
                amount,
                accountKey.publicKey,
                privateKey,
                fee,
                refundAddress,
                blockHeight,
                transactionContext
              );
            },
          });
          const constructedTx = buildAttempt.result;

          const builtRawTx = wasm.nockchainTxToRawTx(constructedTx.nockchainTx);
          const builtInputNoteIds = wasm
            .rawTxInputNames(builtRawTx)
            .map(name => generateNoteId(String(name.first), String(name.last)));
          const builtSelection = resolveBuiltInputSelection(
            buildAttempt.candidates,
            builtInputNoteIds
          );

          // Retry candidates are reservations, not necessarily transaction inputs.
          // Release anything WASM did not select before broadcasting.
          const builtInputSet = new Set(builtSelection.inputNoteIds);
          const unusedReservedNoteIds = selectedNoteIds.filter(
            noteId => !builtInputSet.has(noteId)
          );
          if (unusedReservedNoteIds.length > 0) {
            await this.releaseInFlightNotes(
              currentAccount.address,
              unusedReservedNoteIds,
              walletTxId
            );
          }
          selectedNoteIds = builtSelection.inputNoteIds;

          const actualAmounts = resolveBuiltTransactionAmounts(
            builtSelection.selectedTotal,
            amount,
            constructedTx.feeUsed,
            sendMax
          );

          const protobufTx = wasm.rawTxToProtobuf(builtRawTx);
          const signedTxId = String(builtRawTx.id);

          // Persist the signed identifier before submission so a network error
          // remains reconcilable rather than releasing potentially spent inputs.
          walletTx.inputNoteIds = selectedNoteIds;
          walletTx.fee = actualAmounts.fee;
          walletTx.expectedChange = actualAmounts.expectedChange;
          walletTx.txHash = signedTxId;
          walletTx.trackingTxId = signedTxId;
          walletTx.status = 'broadcast_pending';
          await this.updateWalletTransaction(currentAccount.address, walletTxId, {
            status: 'broadcast_pending',
            inputNoteIds: selectedNoteIds,
            fee: actualAmounts.fee,
            expectedChange: actualAmounts.expectedChange,
            txHash: signedTxId,
            trackingTxId: signedTxId,
          });

          const rpcClient = createBrowserClient(transactionContext.rpcUrl);
          const liveHeight = await rpcClient.getCurrentBlockHeight();
          if (!Number.isSafeInteger(liveHeight) || liveHeight <= 0) {
            throw new Error('Could not verify the current network height; rebuild required');
          }
          const submissionContext = await getTransactionContextSnapshot(liveHeight);
          if (
            submissionContext.fingerprint !== transactionContext.fingerprint ||
            (submissionContext.nextTxEngineActivationHeight !== undefined &&
              submissionContext.nextTxEngineActivationHeight <= liveHeight + 1)
          ) {
            throw new Error('Transaction network settings changed; rebuild required');
          }
          this.assertAccountSyncedForNetwork(
            currentAccount.address,
            submissionContext.networkIdentity
          );
          if (
            this.state.locked ||
            this.accountDataEpoch !== capturedLifecycleEpoch ||
            this.getCurrentAccount()?.address !== currentAccount.address
          ) {
            throw new Error('Signing account changed while the transaction was built');
          }
          broadcastAttempted = true;
          await rpcClient.sendTransaction(protobufTx);

          // 8. Update tx status to broadcasted
          walletTx.status = 'broadcasted_unconfirmed';
          await this.updateWalletTransaction(currentAccount.address, walletTxId, {
            fee: actualAmounts.fee,
            expectedChange: actualAmounts.expectedChange,
            txHash: signedTxId,
            trackingTxId: signedTxId,
            status: 'broadcasted_unconfirmed',
            lastMempoolCheckAt: Date.now(),
            lastConfirmationCheckAt: 0,
          });

          return {
            txId: signedTxId,
            walletTx,
            broadcasted: true,
          };
        } finally {
          privateKey.free();
          // Clean up WASM memory
          if (!this.isMasterAccount(currentAccount)) {
            accountKey.free();
          }
          masterKey.free();
        }
      } catch (error) {
        console.error('[Vault V2] Transaction failed:', error);

        if (!broadcastAttempted && notesReserved && selectedNoteIds.length > 0) {
          try {
            await this.failUnsubmittedExactTransaction(
              currentAccount.address,
              selectedNoteIds,
              walletTxId
            );
          } catch (releaseError) {
            console.error('[Vault V2] Error releasing notes:', releaseError);
          }
        }

        const rawMsg = error instanceof Error ? error.message : String(error);
        return {
          error: broadcastAttempted
            ? `Transaction submission status is unknown: ${rewriteInsufficientFeeErrorToDecimalNock(rawMsg)}`
            : `Transaction failed: ${rewriteInsufficientFeeErrorToDecimalNock(rawMsg)}`,
        };
      }
    });
  }

  /**
   * Build bridge transaction context shared by estimate and send flows.
   */
  private async buildBridgeTransactionContext(
    currentAccount: SubAccount,
    destinationAddress: string,
    amountNicks: Nicks,
    options?: { useAllAvailableNotes?: boolean }
  ): Promise<{
    bridgeResult: Awaited<ReturnType<typeof buildBridgeTransaction>>;
    destinationAddress: string;
    amountNicks: Nicks;
    refundPkh: string;
    wasmNotes: wasm.Note[];
    spendConditions: wasm.SpendCondition[];
    selectedNoteIds: string[];
    estimatedFeeNum: number;
    expectedChangeNicks: bigint;
    txEngineSettings: Awaited<ReturnType<typeof getTxEngineSettingsForHeight>>;
    blockHeight: number;
    transactionContext: Awaited<ReturnType<typeof getTransactionContextSnapshot>>;
  }> {
    const capturedLifecycleEpoch = this.accountDataEpoch;
    await initWasmModules();

    const blockHeight = this.getAccountBlockHeight(currentAccount.address);
    const transactionContext = await getTransactionContextSnapshot(blockHeight);
    this.assertAccountSyncedForNetwork(currentAccount.address, transactionContext.networkIdentity);

    const availableStoredNotes = this.getAvailableNotes(currentAccount.address);
    if (availableStoredNotes.length === 0) {
      throw new Error('No available UTXOs.');
    }

    // Greedy selection headroom for chain fee only (nicks). Keep small: WASM computes the
    // real fee below; an oversized slack blocks near-max bridges (e.g. 105 NOCK → bridge 100).
    const selectionSlackNicks = 10 * NOCK_TO_NICKS;
    const targetAmount = Number(amountNicks) + selectionSlackNicks;
    const selectedStoredNotes = options?.useAllAvailableNotes
      ? availableStoredNotes
      : selectNotesForAmount(availableStoredNotes, targetAmount);
    if (!selectedStoredNotes) {
      throw new Error('Insufficient available funds');
    }

    const selectedNoteIds = selectedStoredNotes.map(n => n.noteId);
    const selectedTotal = selectedStoredNotes.reduce((sum, n) => sum + n.assets, 0);

    const sortedStoredNotes = [...selectedStoredNotes].sort((a, b) => b.assets - a.assets);
    const senderPKH = currentAccount.address;

    const wasmNotes = sortedStoredNotes.map(n => {
      if (!n.protoNote) {
        throw new Error('Note missing protoNote - cannot build bridge transaction');
      }
      return wasm.noteFromProtobuf(n.protoNote);
    });

    const spendConditions = await Promise.all(
      sortedStoredNotes.map(async n => {
        try {
          return await discoverSpendConditionForNote(
            senderPKH,
            {
              nameFirst: n.nameFirst,
              originPage: n.originPage,
            },
            transactionContext.coinbaseTimelockBlocks
          );
        } catch {
          throw new Error(
            `Spend condition discovery failed for note ${n.noteId} (${n.nameFirst.slice(0, 16)}...)`
          );
        }
      })
    );

    const txEngineSettings = transactionContext.txEngineSettings;

    let bridgeResult: Awaited<ReturnType<typeof buildBridgeTransaction>>;
    try {
      bridgeResult = await buildBridgeTransaction(
        {
          inputNotes: wasmNotes,
          spendConditions,
          amountInNicks: amountNicks as Nicks,
          destinationAddress,
          refundPkh: senderPKH,
        },
        BRIDGE_CONFIG,
        { txEngineSettings }
      );
    } catch (error) {
      throw error;
    }

    const builtFeeNum = Number(bridgeResult.fee);
    const expectedChangeNicks = BigInt(selectedTotal) - BigInt(amountNicks) - BigInt(builtFeeNum);

    const rawTx = wasm.nockchainTxToRawTx(bridgeResult.transaction);
    if (!guard.isRawTxV1(rawTx)) {
      throw new Error('Bridge transaction must be version 1');
    }
    const validationParams = {
      destinationAddress,
      amountInNicks: amountNicks,
      refundPkh: senderPKH,
    };
    const validation = await validateBridgeTransaction(rawTx, validationParams, BRIDGE_CONFIG, {
      txEngineSettings,
    });
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Bridge transaction validation failed');
    }
    const currentContext = await getTransactionContextSnapshot(blockHeight);
    if (currentContext.fingerprint !== transactionContext.fingerprint) {
      throw new Error('Transaction network settings changed while the bridge was built');
    }
    this.assertAccountSyncedForNetwork(currentAccount.address, currentContext.networkIdentity);
    if (
      this.state.locked ||
      this.accountDataEpoch !== capturedLifecycleEpoch ||
      this.getCurrentAccount()?.address !== currentAccount.address
    ) {
      throw new Error('Selected account changed while the bridge was built');
    }

    return {
      bridgeResult,
      destinationAddress,
      amountNicks,
      refundPkh: senderPKH,
      wasmNotes,
      spendConditions,
      selectedNoteIds,
      estimatedFeeNum: builtFeeNum,
      expectedChangeNicks,
      txEngineSettings,
      blockHeight,
      transactionContext,
    };
  }

  private async logBridgeReviewTransactionForInspection(
    buildCtx: Awaited<ReturnType<Vault['buildBridgeTransactionContext']>>
  ): Promise<void> {
    const rawTx = wasm.nockchainTxToRawTx(buildCtx.bridgeResult.transaction);
    const signedTx = await this.signRawTx({
      rawTx,
      blockHeight: buildCtx.blockHeight,
      accountAddress: buildCtx.refundPkh,
      txEngineSettings: buildCtx.txEngineSettings,
    });
    const signedRawTx = wasm.nockchainTxToRawTx(signedTx);
    if (!guard.isRawTxV1(signedRawTx)) {
      throw new Error('Bridge transaction must be version 1');
    }
    const signedProtobufTx = wasm.rawTxToProtobuf(signedRawTx);

    const validation = await validateBridgeTransaction(
      signedRawTx,
      {
        destinationAddress: buildCtx.destinationAddress,
        amountInNicks: buildCtx.amountNicks,
        refundPkh: buildCtx.refundPkh,
      },
      BRIDGE_CONFIG,
      { txEngineSettings: buildCtx.txEngineSettings }
    );
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Bridge transaction validation failed');
    }
  }

  /**
   * Estimate the maximum amount that can be bridged while reserving Nockchain network fee.
   * The bridge protocol fee is deducted by the bridge from the bridged amount, not reserved here.
   */
  async estimateMaxBridgeAmount(
    destinationAddress: string
  ): Promise<
    | { maxAmount: number; fee: number; totalAvailable: number; utxoCount: number }
    | { error: string }
  > {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }
    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      return { error: 'Current account is external and cannot sign locally' };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }

    try {
      const maxBridgeContext = await getTransactionContextSnapshot(
        this.getAccountBlockHeight(currentAccount.address)
      );
      this.assertAccountSyncedForNetwork(currentAccount.address, maxBridgeContext.networkIdentity);
      const availableStoredNotes = this.getAvailableNotes(currentAccount.address);
      const totalAvailable = availableStoredNotes.reduce((sum, n) => sum + n.assets, 0);
      const minBridgeAmount = Number(BRIDGE_CONFIG.minAmountNicks);

      if (availableStoredNotes.length === 0) {
        return { error: 'No available UTXOs.' };
      }
      if (totalAvailable <= minBridgeAmount) {
        return { error: 'Balance is too low to cover the minimum bridge amount and network fee.' };
      }

      let buildCtx = await this.buildBridgeTransactionContext(
        currentAccount,
        destinationAddress,
        BRIDGE_CONFIG.minAmountNicks,
        { useAllAvailableNotes: true }
      );
      let fee = Number(buildCtx.bridgeResult.fee);
      let maxAmount = totalAvailable - fee;

      if (maxAmount < minBridgeAmount) {
        return { error: 'Balance is too low to cover the minimum bridge amount and network fee.' };
      }

      for (let i = 0; i < 2; i++) {
        buildCtx = await this.buildBridgeTransactionContext(
          currentAccount,
          destinationAddress,
          String(maxAmount) as Nicks,
          { useAllAvailableNotes: true }
        );
        const nextFee = Number(buildCtx.bridgeResult.fee);
        const nextMaxAmount = totalAvailable - nextFee;
        if (nextFee === fee && nextMaxAmount === maxAmount) {
          break;
        }
        fee = nextFee;
        maxAmount = nextMaxAmount;
        if (maxAmount < minBridgeAmount) {
          return {
            error: 'Balance is too low to cover the minimum bridge amount and network fee.',
          };
        }
      }

      return {
        maxAmount,
        fee,
        totalAvailable,
        utxoCount: availableStoredNotes.length,
      };
    } catch (error) {
      console.error('[Vault] Max bridge estimation failed:', error);
      const rawMsg = error instanceof Error ? error.message : String(error);
      return {
        error: 'Max bridge estimation failed: ' + rewriteInsufficientFeeErrorToDecimalNock(rawMsg),
      };
    }
  }

  /**
   * Mark notes in-flight, sign tx, validate, broadcast, and release on error.
   */
  private async sendBuiltBridgeTransaction(
    currentAccount: SubAccount,
    walletTxId: string,
    buildCtx: Awaited<ReturnType<Vault['buildBridgeTransactionContext']>>,
    walletTx: WalletTransaction,
    capturedLifecycleEpoch: number
  ): Promise<{ txId: string; walletTx: WalletTransaction; broadcasted: boolean }> {
    let notesReserved = false;
    let broadcastAttempted = false;

    try {
      if (
        this.state.locked ||
        this.accountDataEpoch !== capturedLifecycleEpoch ||
        this.getCurrentAccount()?.address !== currentAccount.address
      ) {
        throw new Error('Signing account changed while the bridge was built');
      }
      await this.reserveNotesAndCreateWalletTransaction(
        currentAccount.address,
        buildCtx.selectedNoteIds,
        walletTx
      );
      notesReserved = true;
      const rawTx = wasm.nockchainTxToRawTx(buildCtx.bridgeResult.transaction);
      const signedTx = await this.signRawTx({
        rawTx,
        blockHeight: buildCtx.blockHeight,
        accountAddress: currentAccount.address,
        txEngineSettings: buildCtx.txEngineSettings,
      });
      const signedRawTx = wasm.nockchainTxToRawTx(signedTx);
      if (!guard.isRawTxV1(signedRawTx)) {
        throw new Error('Bridge transaction must be version 1');
      }
      const signedProtobufTx = wasm.rawTxToProtobuf(signedRawTx);
      const signedTxId = signedRawTx.id;
      const validation = await validateBridgeTransaction(
        signedRawTx,
        {
          destinationAddress: buildCtx.destinationAddress,
          amountInNicks: buildCtx.amountNicks,
          refundPkh: buildCtx.refundPkh,
        },
        BRIDGE_CONFIG,
        { txEngineSettings: buildCtx.txEngineSettings }
      );
      if (!validation.valid) {
        throw new Error(validation.error ?? 'Bridge transaction validation failed');
      }
      walletTx.fee = Number(buildCtx.bridgeResult.fee);
      walletTx.txHash = signedTxId;
      walletTx.trackingTxId = signedTxId;
      walletTx.status = 'broadcast_pending';
      await this.updateWalletTransaction(currentAccount.address, walletTxId, {
        fee: walletTx.fee,
        txHash: signedTxId,
        trackingTxId: signedTxId,
        status: 'broadcast_pending',
      });

      const rpcClient = createBrowserClient(buildCtx.transactionContext.rpcUrl);
      const liveHeight = await rpcClient.getCurrentBlockHeight();
      if (!Number.isSafeInteger(liveHeight) || liveHeight <= 0) {
        throw new Error('Could not verify the current network height; rebuild required');
      }
      const submissionContext = await getTransactionContextSnapshot(liveHeight);
      if (
        submissionContext.fingerprint !== buildCtx.transactionContext.fingerprint ||
        (submissionContext.nextTxEngineActivationHeight !== undefined &&
          submissionContext.nextTxEngineActivationHeight <= liveHeight + 1)
      ) {
        throw new Error('Transaction network settings changed; rebuild required');
      }
      this.assertAccountSyncedForNetwork(currentAccount.address, submissionContext.networkIdentity);
      if (this.state.locked || this.getCurrentAccount()?.address !== currentAccount.address) {
        throw new Error('Signing account changed while the bridge was built');
      }
      if (capturedLifecycleEpoch !== this.accountDataEpoch) {
        throw new Error('Wallet lifecycle changed while the bridge was built');
      }
      broadcastAttempted = true;
      await rpcClient.sendTransaction(signedProtobufTx);

      walletTx.status = 'broadcasted_unconfirmed';
      await this.updateWalletTransaction(currentAccount.address, walletTxId, {
        fee: walletTx.fee,
        txHash: signedTxId,
        trackingTxId: signedTxId,
        status: 'broadcasted_unconfirmed',
      });

      return {
        txId: signedTxId,
        walletTx,
        broadcasted: true,
      };
    } catch (error) {
      if (!broadcastAttempted && notesReserved && buildCtx.selectedNoteIds.length > 0) {
        try {
          await this.failUnsubmittedExactTransaction(
            currentAccount.address,
            buildCtx.selectedNoteIds,
            walletTxId
          );
        } catch (releaseError) {
          console.error('[Vault] Error releasing notes:', releaseError);
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        broadcastAttempted ? `Transaction submission status is unknown: ${message}` : message
      );
    }
  }

  /**
   * Estimate the chain fee for a bridge transaction (builds tx, returns fee).
   * Does not lock notes or broadcast.
   */
  async estimateBridgeFee(
    destinationAddress: string,
    amountNicks: Nicks
  ): Promise<{ fee: number } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }
    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      return { error: 'Current account is external and cannot sign locally' };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }

    try {
      const buildCtx = await this.buildBridgeTransactionContext(
        currentAccount,
        destinationAddress,
        amountNicks
      );
      await this.logBridgeReviewTransactionForInspection(buildCtx);
      return { fee: Number(buildCtx.bridgeResult.fee) };
    } catch (error) {
      console.error('[Vault] Bridge fee estimation failed:', error);
      const rawMsg = error instanceof Error ? error.message : String(error);
      return {
        error: 'Fee estimation failed: ' + rewriteInsufficientFeeErrorToDecimalNock(rawMsg),
      };
    }
  }

  /**
   * Build, sign, and broadcast a bridge transaction (Nockchain → Base)
   * Uses UTXO store for spendable balance consistency.
   *
   * @param destinationAddress - EVM address on Base to receive NOCK
   * @param amountNicks - Amount to bridge in nicks
   * @param priceUsdAtTime - Optional USD price for display
   */
  async sendBridgeTransaction(
    destinationAddress: string,
    amountNicks: Nicks,
    priceUsdAtTime?: number
  ): Promise<
    { txId: string; walletTx: WalletTransaction; broadcasted: boolean } | { error: string }
  > {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }
    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      return { error: 'Current account is external and cannot sign locally' };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }
    const capturedLifecycleEpoch = this.accountDataEpoch;

    return withAccountLock(currentAccount.address, async () => {
      const walletTxId = crypto.randomUUID();

      try {
        const buildCtx = await this.buildBridgeTransactionContext(
          currentAccount,
          destinationAddress,
          amountNicks
        );

        const walletTx: WalletTransaction = {
          id: walletTxId,
          accountAddress: currentAccount.address,
          direction: 'outgoing',
          kind: 'bridge',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          priceUsdAtTime,
          status: 'created',
          locallyManagedSubmission: true,
          inputNoteIds: buildCtx.selectedNoteIds,
          recipient: destinationAddress,
          amount: Number(amountNicks),
          fee: buildCtx.estimatedFeeNum,
          expectedChange:
            buildCtx.expectedChangeNicks > 0n ? Number(buildCtx.expectedChangeNicks) : 0,
        };

        return await this.sendBuiltBridgeTransaction(
          currentAccount,
          walletTxId,
          buildCtx,
          walletTx,
          capturedLifecycleEpoch
        );
      } catch (error) {
        console.error('[Vault] Bridge transaction failed:', error);
        const rawMsg = error instanceof Error ? error.message : String(error);
        return {
          error: `Bridge failed: ${rewriteInsufficientFeeErrorToDecimalNock(rawMsg)}`,
        };
      }
    });
  }

  /**
   * Sign a raw transaction using iris-wasm
   *
   * @param params - Transaction parameters with raw tx
   * @returns Signed transaction in canonical NockchainTx form
   */
  async signRawTx(params: {
    rawTx: wasm.RawTx;
    blockHeight?: number;
    accountAddress?: string;
    txEngineSettings?: wasm.TxEngineSettings;
    transactionContextFingerprint?: string;
    authorizationStillValid?: () => boolean;
  }): Promise<wasm.NockchainTx> {
    if (this.state.locked) {
      throw new Error('Wallet is locked');
    }

    const { rawTx } = params;
    assertNativeRawTx(rawTx);

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      throw new Error('No account selected');
    }
    if (params.accountAddress && currentAccount.address !== params.accountAddress) {
      throw new Error('Signing account changed after approval');
    }
    const signingLifecycleEpoch = this.accountDataEpoch;

    const signingMnemonic = this.getSigningMnemonicForCurrentAccount();
    if (!signingMnemonic) {
      throw new Error('Current account is external and cannot sign locally');
    }

    // Cold WASM initialization is asynchronous; do not let a later lifecycle
    // become the baseline for an approval captured in the old session.
    await initWasmModules();
    if (
      this.state.locked ||
      this.accountDataEpoch !== signingLifecycleEpoch ||
      this.getCurrentAccount()?.address !== currentAccount.address
    ) {
      throw new Error('Signing account changed after approval');
    }

    // Derive the account's private key
    const masterKey = wasm.deriveMasterKeyFromMnemonic(signingMnemonic, '');
    const childIndex = currentAccount.index;
    const accountKey = this.isMasterAccount(currentAccount)
      ? masterKey
      : masterKey.deriveChild(childIndex);

    if (!accountKey.privateKey) {
      if (!this.isMasterAccount(currentAccount)) {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Cannot sign: no private key available');
    }

    const privateKey = wasm.PrivateKey.fromBytes(accountKey.privateKey);

    try {
      // Use the same account block height as the approval descriptor.
      const blockHeight = params.blockHeight ?? this.getAccountBlockHeight(currentAccount.address);
      const settings = params.txEngineSettings ?? (await txEngineSettings(blockHeight));
      if (!guard.isRawTxV1(rawTx)) {
        throw new Error('Only v1 raw transactions are supported');
      }
      const builder = wasm.TxBuilder.fromRawTx(rawTx, settings);
      try {
        await builder.sign(privateKey);

        if (
          this.state.locked ||
          this.accountDataEpoch !== signingLifecycleEpoch ||
          this.getCurrentAccount()?.address !== currentAccount.address
        ) {
          throw new Error('Signing account changed after approval');
        }

        if (params.transactionContextFingerprint) {
          const currentContext = await getTransactionContextSnapshot(blockHeight);
          if (currentContext.fingerprint !== params.transactionContextFingerprint) {
            throw new Error('Transaction network settings changed after approval');
          }
        }
        if (
          this.state.locked ||
          this.accountDataEpoch !== signingLifecycleEpoch ||
          this.getCurrentAccount()?.address !== currentAccount.address ||
          (params.authorizationStillValid && !params.authorizationStillValid())
        ) {
          throw new Error('Signing account or authorization changed after approval');
        }

        // Validate before build (surfaces missing unlocks, fee, balanced spends)
        builder.validate();

        // Build signed tx (returns plain NockchainTx data)
        const signedTx = builder.build();
        return signedTx;
      } finally {
        builder.free();
      }
    } finally {
      privateKey.free();

      if (!this.isMasterAccount(currentAccount)) {
        accountKey.free();
      }
      masterKey.free();
    }
  }

  async computeOutputs(rawTx: wasm.RawTx): Promise<any[]> {
    if (this.state.locked) {
      throw new Error('Wallet is locked');
    }

    // Initialize WASM modules
    await initWasmModules();

    try {
      assertNativeRawTx(rawTx);
      const currentAccount = this.getCurrentAccount();
      const cachedBlockHeight = currentAccount
        ? this.getCachedAccountBlockHeight(currentAccount.address)
        : 0;
      const blockHeight = cachedBlockHeight || (await latestConfiguredTxEngineHeight());
      const settings = await txEngineSettings(blockHeight);
      const outputs = wasm.rawTxOutputs(rawTx, blockHeight, settings);
      return outputs.map(output => wasm.noteToProtobuf(output));
    } catch (err) {
      console.error('Failed to compute outputs:', err);
      throw err;
    }
  }

  /**
   * Build the trusted review model for a dApp-supplied raw transaction.
   *
   * Input names come from the raw transaction and are resolved exclusively against
   * the selected account's encrypted UTXO store. DApp-supplied note metadata is
   * intentionally ignored so it cannot influence the approval display.
   */
  async describeRawTxForApproval(rawTx: wasm.RawTx): Promise<{
    transactionId: string;
    signingIntentId: string;
    totalFee: Nicks;
    blockHeight: number;
    accountAddress: string;
    inputs: unknown[];
    inputsVerified: boolean;
    inputCount: number;
    outputs: unknown[];
    transactionContext: Awaited<ReturnType<typeof getTransactionContextSnapshot>>;
  }> {
    if (this.state.locked) {
      throw new Error('Wallet is locked');
    }

    await initWasmModules();
    assertNativeRawTx(rawTx);
    if (!guard.isRawTxV1(rawTx)) {
      throw new Error('Only v1 raw transactions are supported');
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      throw new Error('No account selected');
    }

    const blockHeight = this.getAccountBlockHeight(currentAccount.address);
    const transactionContext = await getTransactionContextSnapshot(blockHeight);
    this.assertAccountSyncedForNetwork(currentAccount.address, transactionContext.networkIdentity);

    const inputNames = wasm.rawTxInputNames(rawTx);
    if (inputNames.length === 0) {
      throw new Error('Transaction has no inputs');
    }

    const availableNotes = new Map(
      this.getAvailableNotes(currentAccount.address).map(note => [note.noteId, note])
    );
    const resolvedInputs = inputNames.map(name => {
      const noteId = generateNoteId(String(name.first), String(name.last));
      const storedNote = availableNotes.get(noteId);
      return storedNote?.protoNote;
    });
    const inputsVerified = resolvedInputs.every(input => input !== undefined);
    const inputs = inputsVerified ? resolvedInputs : [];

    // Keep output derivation on the exact transaction-engine settings used by signRawTx.
    const settings = transactionContext.txEngineSettings;
    const outputs = wasm
      .rawTxOutputs(rawTx, blockHeight, settings)
      .map(output => wasm.noteToProtobuf(output));
    const intentBuilder = wasm.TxBuilder.fromRawTx(rawTx, settings);
    let signingIntentId: string;
    try {
      // Rebuilding splits witness data from spends. Hashing those witnessless
      // spends produces an intent ID that remains stable as signatures are added.
      signingIntentId = String(wasm.spendsV1Hash(intentBuilder.build().spends));
    } finally {
      intentBuilder.free();
    }

    const currentContext = await getTransactionContextSnapshot(blockHeight);
    if (
      currentContext.fingerprint !== transactionContext.fingerprint ||
      this.state.locked ||
      this.getCurrentAccount()?.address !== currentAccount.address
    ) {
      throw new Error('Transaction review context changed while it was being prepared');
    }
    this.assertAccountSyncedForNetwork(currentAccount.address, currentContext.networkIdentity);

    return {
      transactionId: String(wasm.rawTxId(rawTx)),
      signingIntentId,
      totalFee: String(wasm.rawTxTotalFees(rawTx)) as Nicks,
      blockHeight,
      accountAddress: currentAccount.address,
      inputs,
      inputsVerified,
      inputCount: inputNames.length,
      outputs,
      transactionContext,
    };
  }
}
