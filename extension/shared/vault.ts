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
import { ERROR_CODES, STORAGE_KEYS, ACCOUNT_COLORS, PRESET_WALLET_STYLES } from './constants';
import { Account } from './types';
import { buildMultiNotePayment, type Note as TxBuilderNote } from './transaction-builder';
import {
  deriveMasterKeyFromMnemonic,
  signMessage as wasmSignMessage,
} from '../lib/nbx-wasm/nbx_wasm.js';
import { queryV1Balance } from './balance-query';
import { createBrowserClient } from './rpc-client-browser';
import type { Note as BalanceNote } from './types';
import { base58 } from '@scure/base';
import { USE_MOCK_TRANSACTIONS, MOCK_TRANSACTIONS } from './mocks/transactions';
import { initWasmModules } from './wasm-utils';

/**
 * Convert a balance query note to transaction builder note format
 * @param note - Note from balance query (with Uint8Array names)
 * @returns Note in format expected by transaction builder
 *
 * NOTE: Prefers pre-computed base58 values from the RPC response to avoid WASM init issues
 */
async function convertNoteForTxBuilder(
  note: BalanceNote,
  ownerPKH: string
): Promise<TxBuilderNote> {
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
    // Use pre-computed noteDataHash from RPC response
    console.log('[Vault] Using pre-computed noteDataHash from RPC response');
    noteDataHash = note.noteDataHashBase58;
  } else {
    // Fallback to empty string if not provided
    // The protoNote field will be used by WasmNote.fromProtobuf() instead
    console.warn(
      '[Vault] No noteDataHashBase58 - relying on protoNote for WasmNote.fromProtobuf()'
    );
    noteDataHash = '';
  }

  return {
    originPage: Number(note.originPage),
    nameFirst,
    nameLast,
    noteDataHash,
    assets: note.assets,
    protoNote: note.protoNote, // Pass through for WasmNote.fromProtobuf()
  };
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
 * The decrypted vault payload
 * Everything sensitive lives inside the encrypted vault
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

    console.log('[Vault.setup] Deriving address from master key...');
    const masterAddress = await deriveAddressFromMaster(words);
    console.log('[Vault.setup] Got master address:', masterAddress);

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

    // Encrypt both mnemonic AND accounts together
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
      STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
    ]);
    const enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as EncryptedVault | undefined;
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

      // Parse vault payload (mnemonic + accounts)
      const payload = JSON.parse(pt) as VaultPayload;
      const mnemonic = payload.mnemonic;
      const accounts = payload.accounts;

      // Store decrypted data in memory (only after successful decrypt)
      this.mnemonic = mnemonic;
      this.encryptionKey = key; // Cache key for account operations

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
   * Get balance for the current account
   * Queries the blockchain via RPC for V1 PKH address balance
   *
   * @returns Balance information including total NOCK, nicks, and UTXO count
   */
  async getBalance(): Promise<
    | {
        totalNock: number;
        totalNicks: bigint;
        utxoCount: number;
      }
    | { error: string }
  > {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      return { error: ERROR_CODES.NO_ACCOUNT };
    }

    try {
      // Create RPC client
      const rpcClient = createBrowserClient();

      console.log('[Vault] Querying balance for', currentAccount.address.slice(0, 20) + '...');

      // Query balance using V1 balance query (derives first-names automatically)
      const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

      console.log('[Vault]  Balance retrieved:', {
        totalNock: balanceResult.totalNock,
        totalNicks: balanceResult.totalNicks.toString(),
        utxoCount: balanceResult.utxoCount,
      });

      return {
        totalNock: balanceResult.totalNock,
        totalNicks: balanceResult.totalNicks,
        utxoCount: balanceResult.utxoCount,
      };
    } catch (error) {
      console.error('[Vault] Error fetching balance:', error);
      return {
        error:
          'Failed to fetch balance: ' + (error instanceof Error ? error.message : 'Unknown error'),
      };
    }
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
   */
  async signMessage(params: unknown): Promise<string> {
    if (this.state.locked || !this.mnemonic) {
      throw new Error('Wallet is locked');
    }

    // Initialize WASM modules
    await initWasmModules();

    const msg = (Array.isArray(params) ? params[0] : params) ?? '';
    const msgString = String(msg);

    // Derive the account's private key based on derivation method
    const masterKey = deriveMasterKeyFromMnemonic(this.mnemonic, '');
    const currentAccount = this.getCurrentAccount();
    // Use the account's own index, not currentAccountIndex (accounts may be reordered)
    const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
    const accountKey =
      currentAccount?.derivation === 'master'
        ? masterKey // Use master key directly for master-derived accounts
        : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

    if (!accountKey.private_key) {
      if (currentAccount?.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Cannot sign: no private key available');
    }

    // Sign the message
    const signature = wasmSignMessage(accountKey.private_key, msgString);

    // Convert signature to JSON format
    const signatureJson = JSON.stringify({
      c: Array.from(signature.c),
      s: Array.from(signature.s),
    });

    // Clean up WASM memory
    signature.free();
    if (currentAccount?.derivation !== 'master') {
      accountKey.free();
    }
    masterKey.free();

    // Return the signature JSON
    return signatureJson;
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
    const masterKey = deriveMasterKeyFromMnemonic(this.mnemonic, '');
    // Use the account's own index, not currentAccountIndex (accounts may be reordered)
    const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
    const accountKey =
      currentAccount.derivation === 'master'
        ? masterKey // Use master key directly for master-derived accounts
        : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

    if (!accountKey.private_key || !accountKey.public_key) {
      if (currentAccount.derivation !== 'master') {
        accountKey.free();
      }
      masterKey.free();
      throw new Error('Cannot sign: keys unavailable');
    }

    try {
      // Create RPC client
      const rpcClient = createBrowserClient();

      console.log('[Vault] Fetching UTXOs for', currentAccount.address.slice(0, 20) + '...');
      const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

      if (balanceResult.utxoCount === 0) {
        throw new Error('No UTXOs available. Your wallet may have zero balance.');
      }

      console.log(
        `[Vault] Found ${balanceResult.utxoCount} UTXOs (${balanceResult.simpleNotes.length} simple, ${balanceResult.coinbaseNotes.length} coinbase)`
      );

      // Combine simple and coinbase notes
      const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

      // Calculate total available
      const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);
      console.log(
        `[Vault] Passing ${notes.length} UTXO(s) to WASM (total: ${totalAvailable} nicks, need: ${amount} + fee)`
      );

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
        accountKey.public_key,
        accountKey.private_key,
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
      const masterKey = deriveMasterKeyFromMnemonic(this.mnemonic, '');
      const childIndex = currentAccount.index ?? this.state.currentAccountIndex;
      const accountKey =
        currentAccount.derivation === 'master' ? masterKey : masterKey.deriveChild(childIndex);

      if (!accountKey.private_key || !accountKey.public_key) {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
        return { error: 'Cannot estimate fee: keys unavailable' };
      }

      try {
        const rpcClient = createBrowserClient();

        console.log('[Vault] Fetching UTXOs for fee estimation...');
        const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

        if (balanceResult.utxoCount === 0) {
          return { error: 'No UTXOs available. Your wallet may have zero balance.' };
        }

        const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

        const txBuilderNotes = await Promise.all(
          notes.map(note => convertNoteForTxBuilder(note, currentAccount.address))
        );

        // Build a tx with fee = undefined → WASM auto-calculates using DEFAULT_FEE_PER_WORD
        // If the first pass fails with "Insufficient fee", try again with the needed fee
        let feeNicks: number;

        try {
          const constructedTx = await buildMultiNotePayment(
            txBuilderNotes,
            to,
            amount,
            accountKey.public_key,
            accountKey.private_key,
            undefined // let WASM auto-calc
          );

          // Inspect protobuf to read fee from witness
          const protobufTx = constructedTx.rawTx.toProtobuf();

          // Extract fee from the witness structure
          const spendEntry = protobufTx.spends?.[0];
          const feeValue =
            spendEntry?.spend?.spend_kind?.witness?.fee ?? spendEntry?.spend?.witness?.fee;

          if (feeValue === undefined || feeValue === null) {
            return { error: 'Could not determine fee from constructed transaction' };
          }

          // Normalize to number (handle bigint/string/number)
          const normalize = (v: any): number => {
            if (typeof v === 'bigint') return Number(v);
            if (typeof v === 'string') return Number(BigInt(v));
            return Number(v);
          };

          feeNicks = normalize(feeValue);
        } catch (error) {
          // If we get "Insufficient fee", extract the needed fee from the error
          const errorMsg = error instanceof Error ? error.message : String(error);
          const insufficientFeeMatch = errorMsg.match(/needed: (\d+)/);

          if (insufficientFeeMatch) {
            feeNicks = parseInt(insufficientFeeMatch[1], 10);
            console.log('[Vault] Extracted needed fee from error:', feeNicks, 'nicks');
          } else {
            throw error; // Re-throw if it's not an insufficient fee error
          }
        }

        console.log('[Vault] Estimated fee:', feeNicks, 'nicks');
        return { fee: feeNicks };
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
   * Build and sign a transaction without broadcasting it
   * This allows the UI to pre-build transactions for review before broadcasting
   *
   * @param to - Recipient PKH address (base58-encoded digest string)
   * @param amount - Amount in nicks
   * @param fee - Transaction fee in nicks (optional, WASM will auto-calculate if not provided)
   * @returns Transaction ID and protobuf transaction object (not broadcasted)
   */
  async buildAndSignTransaction(
    to: string,
    amount: number,
    fee: number
  ): Promise<{ txId: string; protobufTx: any; jammedTx: Uint8Array } | { error: string }> {
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
      const masterKey = deriveMasterKeyFromMnemonic(this.mnemonic, '');
      const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
      const accountKey =
        currentAccount.derivation === 'master' ? masterKey : masterKey.deriveChild(childIndex);

      if (!accountKey.private_key || !accountKey.public_key) {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
        return { error: 'Keys unavailable' };
      }

      try {
        // Create RPC client
        const rpcClient = createBrowserClient();

        console.log('[Vault] Fetching UTXOs for transaction...');
        const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

        if (balanceResult.utxoCount === 0) {
          return { error: 'No UTXOs available. Your wallet may have zero balance.' };
        }

        console.log(`[Vault] Found ${balanceResult.utxoCount} UTXOs`);

        // Combine simple and coinbase notes
        const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

        // Calculate total available
        const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);
        console.log(
          `[Vault] Passing ${notes.length} UTXO(s) to WASM (total: ${totalAvailable} nicks, need: ${amount} + fee)`
        );

        // Convert ALL notes to transaction builder format
        // WASM will automatically select the minimum number needed
        const txBuilderNotes = await Promise.all(
          notes.map(note => convertNoteForTxBuilder(note, currentAccount.address))
        );

        // Build and sign the transaction
        console.log('[Vault] Building transaction with params:', {
          recipientPKH: to.slice(0, 20) + '...',
          availableInputs: txBuilderNotes.length,
          amount,
          fee: fee !== undefined ? fee : 'auto-calculated by WASM',
          senderPublicKey: base58.encode(accountKey.public_key).slice(0, 20) + '...',
        });

        // Always use buildMultiNotePayment - it handles both single and multiple notes
        // WASM will automatically select the minimum number of notes needed
        const constructedTx = await buildMultiNotePayment(
          txBuilderNotes,
          to,
          amount,
          accountKey.public_key,
          accountKey.private_key,
          fee
        );

        console.log('[Vault] Transaction signed:', constructedTx.txId);

        // Convert to protobuf format for gRPC
        const protobufTx = constructedTx.rawTx.toProtobuf();

        return {
          txId: constructedTx.txId,
          protobufTx,
          jammedTx: constructedTx.rawTx.toJam(),
        };
      } finally {
        // Clean up WASM memory
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
      }
    } catch (error) {
      console.error('[Vault] Error building and signing transaction:', error);
      return {
        error: `Failed to build and sign transaction: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Broadcast a raw signed transaction to the network
   * This is a simpler method that doesn't require note conversion or WASM
   *
   * @param protobufTx - The protobuf transaction object (not WASM, already converted)
   * @returns Transaction ID and broadcast status
   */
  async broadcastTransaction(
    protobufTx: any
  ): Promise<{ txId: string; broadcasted: boolean } | { error: string }> {
    try {
      const rpcClient = createBrowserClient();
      console.log('[Vault] Broadcasting pre-signed transaction...');

      const txId = await rpcClient.sendTransaction(protobufTx);

      console.log('[Vault] Transaction broadcasted successfully:', txId);

      return {
        txId,
        broadcasted: true,
      };
    } catch (error) {
      console.error('[Vault] Error broadcasting transaction:', error);
      return {
        error: `Failed to broadcast transaction: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Send a transaction to the network
   * This is the high-level API for sending NOCK to a recipient
   * TODO: Clean up logs
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
      const masterKey = deriveMasterKeyFromMnemonic(this.mnemonic, '');
      // Use the account's own index, not currentAccountIndex (accounts may be reordered)
      const childIndex = currentAccount?.index ?? this.state.currentAccountIndex;
      const accountKey =
        currentAccount.derivation === 'master'
          ? masterKey // Use master key directly for master-derived accounts
          : masterKey.deriveChild(childIndex); // Use child derivation for slip10 accounts

      if (!accountKey.private_key || !accountKey.public_key) {
        if (currentAccount.derivation !== 'master') {
          accountKey.free();
        }
        masterKey.free();
        return { error: 'Keys unavailable' };
      }

      try {
        // Create RPC client
        const rpcClient = createBrowserClient();

        console.log('[Vault] Fetching UTXOs for transaction...');
        const balanceResult = await queryV1Balance(currentAccount.address, rpcClient);

        if (balanceResult.utxoCount === 0) {
          return { error: 'No UTXOs available. Your wallet may have zero balance.' };
        }

        console.log(`[Vault] Found ${balanceResult.utxoCount} UTXOs`);

        // Combine simple and coinbase notes
        const notes = [...balanceResult.simpleNotes, ...balanceResult.coinbaseNotes];

        // Calculate total available
        const totalAvailable = notes.reduce((sum, note) => sum + note.assets, 0);
        console.log(
          `[Vault] Passing ${notes.length} UTXO(s) to WASM (total: ${totalAvailable} nicks, need: ${amount} + fee)`
        );

        // Convert ALL notes to transaction builder format
        // WASM will automatically select the minimum number needed
        const txBuilderNotes = await Promise.all(
          notes.map(note => convertNoteForTxBuilder(note, currentAccount.address))
        );

        // Build and sign the transaction
        console.log('[Vault] Building transaction with params:', {
          recipientPKH: to.slice(0, 20) + '...',
          availableInputs: txBuilderNotes.length,
          amount,
          fee: fee !== undefined ? fee : 'auto-calculated by WASM',
          senderPublicKey: base58.encode(accountKey.public_key).slice(0, 20) + '...',
        });

        // Always use buildMultiNotePayment - it handles both single and multiple notes
        // WASM will automatically select the minimum number of notes needed
        const constructedTx = await buildMultiNotePayment(
          txBuilderNotes,
          to,
          amount,
          accountKey.public_key,
          accountKey.private_key,
          fee
        );

        console.log('[Vault] Transaction signed:', constructedTx.txId);
        console.log('[Vault] Transaction version:', constructedTx.version);
        console.log('[Vault] RawTx object keys:', Object.keys(constructedTx.rawTx));

        // Convert to protobuf format for gRPC
        const protobufTx = constructedTx.rawTx.toProtobuf();
        console.log('[Vault] Protobuf tx object keys:', Object.keys(protobufTx));
        console.log(
          '[Vault] Protobuf tx sample:',
          JSON.stringify(protobufTx).slice(0, 200) + '...'
        );

        // DEBUG: Log the spend details
        if (protobufTx.spends && protobufTx.spends.length > 0) {
          const spendEntry = protobufTx.spends[0];
          console.log('[Vault] First spend entry:', {
            spendEntryKeys: Object.keys(spendEntry),
            hasName: !!spendEntry.name,
            hasSpend: !!spendEntry.spend,
            name: spendEntry.name
              ? {
                  first: spendEntry.name.first?.slice(0, 20) + '...',
                  last: spendEntry.name.last?.slice(0, 20) + '...',
                }
              : 'missing',
          });

          if (spendEntry.spend) {
            console.log('[Vault] Spend object:', {
              spendKeys: Object.keys(spendEntry.spend),
              hasWitness: !!spendEntry.spend.witness,
              hasLegacy: !!spendEntry.spend.legacy,
              spend_kind: spendEntry.spend.spend_kind,
            });

            // Check if spend_kind contains the actual spend data
            if (spendEntry.spend.spend_kind) {
              console.log('[Vault] Spend kind:', {
                spendKindKeys: Object.keys(spendEntry.spend.spend_kind),
                hasWitness: !!spendEntry.spend.spend_kind.witness,
                hasLegacy: !!spendEntry.spend.spend_kind.legacy,
              });

              if (spendEntry.spend.spend_kind.witness) {
                console.log('[Vault] Witness spend:', {
                  witnessKeys: Object.keys(spendEntry.spend.spend_kind.witness),
                  seedCount: spendEntry.spend.spend_kind.witness.seeds?.length || 0,
                  fee: spendEntry.spend.spend_kind.witness.fee,
                });
              }
            }

            if (spendEntry.spend.witness) {
              console.log('[Vault] Witness spend (direct):', {
                witnessKeys: Object.keys(spendEntry.spend.witness),
                seedCount: spendEntry.spend.witness.seeds?.length || 0,
                fee: spendEntry.spend.witness.fee,
              });
            }
          }
        }

        // Broadcast the transaction to the network
        console.log('[Vault] Broadcasting transaction...');
        const broadcastTxId = await rpcClient.sendTransaction(protobufTx);

        console.log('[Vault]  Transaction broadcasted successfully:', broadcastTxId);

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
   * Adds a transaction to the cache for a specific account
   */
  async addTransactionToCache(
    accountAddress: string,
    transaction: import('./types').CachedTransaction
  ): Promise<void> {
    // Get existing cache
    const result = await chrome.storage.local.get([STORAGE_KEYS.TRANSACTION_CACHE]);
    const cache: import('./types').TransactionCache = result[STORAGE_KEYS.TRANSACTION_CACHE] || {};

    // Initialize array for this account if it doesn't exist
    if (!cache[accountAddress]) {
      cache[accountAddress] = [];
    }

    // Check if transaction already exists
    const exists = cache[accountAddress].some(tx => tx.txid === transaction.txid);
    if (exists) {
      return; // Don't add duplicates
    }

    // Add transaction to the beginning (most recent first)
    cache[accountAddress].unshift(transaction);

    // Limit to 100 transactions per account
    if (cache[accountAddress].length > 100) {
      cache[accountAddress] = cache[accountAddress].slice(0, 100);
    }

    // Save to storage
    await chrome.storage.local.set({
      [STORAGE_KEYS.TRANSACTION_CACHE]: cache,
    });
  }

  /**
   * Gets cached transactions for a specific account
   */
  async getCachedTransactions(
    accountAddress: string
  ): Promise<import('./types').CachedTransaction[]> {
    // Return mock transactions if enabled
    if (USE_MOCK_TRANSACTIONS) {
      console.log('[Vault] Returning mock transactions (USE_MOCK_TRANSACTIONS = true)');
      return MOCK_TRANSACTIONS;
    }

    const result = await chrome.storage.local.get([STORAGE_KEYS.TRANSACTION_CACHE]);
    const cache: import('./types').TransactionCache = result[STORAGE_KEYS.TRANSACTION_CACHE] || {};
    return cache[accountAddress] || [];
  }

  /**
   * Updates the status of a cached transaction
   */
  async updateTransactionStatus(
    accountAddress: string,
    txid: string,
    status: 'confirmed' | 'pending' | 'failed'
  ): Promise<void> {
    // Get existing cache
    const result = await chrome.storage.local.get([STORAGE_KEYS.TRANSACTION_CACHE]);
    const cache: import('./types').TransactionCache = result[STORAGE_KEYS.TRANSACTION_CACHE] || {};

    // Find and update the transaction
    if (cache[accountAddress]) {
      const txIndex = cache[accountAddress].findIndex(tx => tx.txid === txid);
      if (txIndex !== -1) {
        cache[accountAddress][txIndex].status = status;

        // Save to storage
        await chrome.storage.local.set({
          [STORAGE_KEYS.TRANSACTION_CACHE]: cache,
        });

        console.log(`[Vault] Updated transaction ${txid.slice(0, 20)}... status to: ${status}`);
      }
    }
  }

  /**
   * Updates the last sync timestamp for an account
   */
  async updateLastSync(accountAddress: string): Promise<void> {
    const result = await chrome.storage.local.get([STORAGE_KEYS.LAST_TX_SYNC]);
    const timestamps: import('./types').LastSyncTimestamps =
      result[STORAGE_KEYS.LAST_TX_SYNC] || {};

    timestamps[accountAddress] = Date.now();

    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_TX_SYNC]: timestamps,
    });
  }

  /**
   * Gets the last sync timestamp for an account
   */
  async getLastSync(accountAddress: string): Promise<number> {
    const result = await chrome.storage.local.get([STORAGE_KEYS.LAST_TX_SYNC]);
    const timestamps: import('./types').LastSyncTimestamps =
      result[STORAGE_KEYS.LAST_TX_SYNC] || {};
    return timestamps[accountAddress] || 0;
  }

  /**
   * Checks if cache should be refreshed (older than 5 minutes)
   */
  async shouldRefreshCache(accountAddress: string): Promise<boolean> {
    const lastSync = await this.getLastSync(accountAddress);
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() - lastSync > fiveMinutes;
  }
}
