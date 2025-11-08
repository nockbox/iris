/**
 * Vault: manages encrypted mnemonic storage and wallet state
 */

import { encryptGCM, decryptGCM, deriveKeyPBKDF2, rand, PBKDF2_ITERATIONS } from "./webcrypto";
import { generateMnemonic, deriveAddress, validateMnemonic } from "./wallet-crypto";
import { ERROR_CODES, STORAGE_KEYS } from "./constants";
import { Account } from "./types";
import { buildPayment, createSinglePKHSpendCondition, calculateNoteDataHash, type Note } from "./transaction-builder";
import { digestBytesToString } from "./address-encoding";
import initCryptoWasm, { signDigest, tip5Hash } from '../lib/nbx-crypto/nbx_crypto.js';
import { deriveMasterKeyFromMnemonic } from '../lib/nbx-nockchain-types/nbx_nockchain_types.js';

/**
 * Versioned encrypted vault format
 * Explicitly separates PBKDF2 (key derivation) from AES-GCM (encryption) parameters
 */
interface EncryptedVaultV1 {
  version: 1;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: number[];  // PBKDF2 salt for key derivation
  };
  cipher: {
    alg: 'AES-GCM';
    iv: number[];    // AES-GCM initialization vector (12 bytes)
    ct: number[];    // Ciphertext (includes authentication tag)
  };
}

interface VaultState {
  locked: boolean;
  accounts: Account[];
  currentAccountIndex: number;
  enc: EncryptedVaultV1 | null;
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

    // Create first account (Account 1 at index 0)
    const firstAccount: Account = {
      name: "Account 1",
      address: await deriveAddress(words, 0),
      index: 0,
    };

    // Generate PBKDF2 salt and derive encryption key
    const kdfSalt = rand(16);
    const { key } = await deriveKeyPBKDF2(password, kdfSalt);

    // Encrypt mnemonic with AES-GCM
    const { iv, ct } = await encryptGCM(
      key,
      new TextEncoder().encode(words)
    );

    // Store in versioned format (arrays for chrome.storage compatibility)
    const encData: EncryptedVaultV1 = {
      version: 1,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: PBKDF2_ITERATIONS,
        salt: Array.from(kdfSalt),  // PBKDF2 salt
      },
      cipher: {
        alg: 'AES-GCM',
        iv: Array.from(iv),  // AES-GCM IV (12 bytes)
        ct: Array.from(ct),  // Ciphertext + auth tag
      },
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.ENCRYPTED_VAULT]: encData,
      [STORAGE_KEYS.ACCOUNTS]: [firstAccount],
      [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: 0,
    });

    // Keep wallet unlocked after setup for smooth onboarding UX
    // Auto-lock timer will handle locking after inactivity
    this.mnemonic = words;
    this.state = {
      locked: false,
      accounts: [firstAccount],
      currentAccountIndex: 0,
      enc: encData
    };

    return { ok: true, address: firstAccount.address, mnemonic: words };
  }

  /**
   * Unlocks the vault with the provided password
   */
  async unlock(
    password: string
  ): Promise<{ ok: boolean; address: string; accounts: Account[]; currentAccount: Account } | { error: string }> {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ENCRYPTED_VAULT,
      STORAGE_KEYS.ACCOUNTS,
      STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
    ]);
    const enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as
      | EncryptedVaultV1
      | undefined;
    const accounts = (stored[STORAGE_KEYS.ACCOUNTS] as Account[] | undefined) || [];
    const currentAccountIndex = (stored[STORAGE_KEYS.CURRENT_ACCOUNT_INDEX] as number | undefined) || 0;

    if (!enc) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    try {
      // Re-derive key using stored KDF parameters
      const { key } = await deriveKeyPBKDF2(
        password,
        new Uint8Array(enc.kdf.salt)
      );

      // Decrypt mnemonic
      const pt = await decryptGCM(
        key,
        new Uint8Array(enc.cipher.iv),
        new Uint8Array(enc.cipher.ct)
      ).catch(() => null);

      if (!pt) {
        return { error: ERROR_CODES.BAD_PASSWORD };
      }

      // Store decrypted mnemonic in memory (only while unlocked)
      this.mnemonic = pt;

      this.state = {
        locked: false,
        accounts,
        currentAccountIndex,
        enc
      };

      const currentAccount = accounts[currentAccountIndex] || accounts[0];
      return {
        ok: true,
        address: currentAccount?.address || "",
        accounts,
        currentAccount
      };
    } catch (err) {
      return { error: ERROR_CODES.BAD_PASSWORD };
    }
  }

  /**
   * Locks the vault
   */
  async lock(): Promise<{ ok: boolean }> {
    this.state.locked = true;
    // Clear mnemonic from memory for security
    this.mnemonic = null;
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
    return account?.address || "";
  }

  /**
   * Gets all accounts
   */
  getAccounts(): Account[] {
    return this.state.accounts;
  }

  /**
   * Gets the address safely (even when locked, from storage)
   */
  async getAddressSafe(): Promise<string> {
    if (this.state.accounts.length > 0) {
      const currentAccount = this.state.accounts[this.state.currentAccountIndex] || this.state.accounts[0];
      return currentAccount.address;
    }
    const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCOUNTS, STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]);
    const accounts = (stored[STORAGE_KEYS.ACCOUNTS] as Account[] | undefined) || [];
    const currentAccountIndex = (stored[STORAGE_KEYS.CURRENT_ACCOUNT_INDEX] as number | undefined) || 0;
    const currentAccount = accounts[currentAccountIndex] || accounts[0];
    return currentAccount?.address || "";
  }

  /**
   * Creates a new account by deriving the next index
   */
  async createAccount(name?: string): Promise<{ ok: boolean; account: Account } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    if (!this.mnemonic) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    const nextIndex = this.state.accounts.length;
    const accountName = name || `Account ${nextIndex + 1}`;

    const newAccount: Account = {
      name: accountName,
      address: await deriveAddress(this.mnemonic, nextIndex),
      index: nextIndex,
    };

    const updatedAccounts = [...this.state.accounts, newAccount];

    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCOUNTS]: updatedAccounts,
    });

    this.state.accounts = updatedAccounts;

    return { ok: true, account: newAccount };
  }

  /**
   * Switches to a different account
   */
  async switchAccount(index: number): Promise<{ ok: boolean; account: Account } | { error: string }> {
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

    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCOUNTS]: this.state.accounts,
    });

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

    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCOUNTS]: this.state.accounts,
    });

    return { ok: true };
  }

  /**
   * Gets the mnemonic phrase (only when unlocked)
   * Requires password verification for security
   */
  async getMnemonic(password: string): Promise<{ ok: boolean; mnemonic: string } | { error: string }> {
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
        new Uint8Array(this.state.enc.kdf.salt)
      );

      const pt = await decryptGCM(
        key,
        new Uint8Array(this.state.enc.cipher.iv),
        new Uint8Array(this.state.enc.cipher.ct)
      ).catch(() => null);

      if (!pt) {
        return { error: ERROR_CODES.BAD_PASSWORD };
      }

      return { ok: true, mnemonic: pt };
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
      throw new Error("Wallet is locked");
    }

    // Initialize WASM module
    // In service worker context, we need to provide the explicit URL
    const cryptoWasmUrl = chrome.runtime.getURL('lib/nbx-crypto/nbx_crypto_bg.wasm');
    await initCryptoWasm({ module_or_path: cryptoWasmUrl });

    const msg = (Array.isArray(params) ? params[0] : params) ?? "";
    const msgBytes = new TextEncoder().encode(String(msg));

    // Derive the account's private key
    const masterKey = deriveMasterKeyFromMnemonic(this.mnemonic, "");
    const accountKey = masterKey.deriveChild(this.state.currentAccountIndex);

    if (!accountKey.private_key) {
      masterKey.free();
      accountKey.free();
      throw new Error("Cannot sign: no private key available");
    }

    // Hash the message with TIP5
    const digest = tip5Hash(msgBytes);

    // Sign the digest
    const signatureJson = signDigest(accountKey.private_key, digest);

    // Clean up WASM memory
    accountKey.free();
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
  async signTransaction(to: string, amount: number, fee: number): Promise<string> {
    if (this.state.locked || !this.mnemonic) {
      throw new Error("Wallet is locked");
    }

    const currentAccount = this.getCurrentAccount();
    if (!currentAccount) {
      throw new Error("No account selected");
    }

    // Initialize crypto WASM module
    const cryptoWasmUrl = chrome.runtime.getURL('lib/nbx-crypto/nbx_crypto_bg.wasm');
    await initCryptoWasm({ module_or_path: cryptoWasmUrl });

    // Derive the account's private and public keys
    const masterKey = deriveMasterKeyFromMnemonic(this.mnemonic, "");
    const accountKey = masterKey.deriveChild(this.state.currentAccountIndex);

    if (!accountKey.private_key || !accountKey.public_key) {
      masterKey.free();
      accountKey.free();
      throw new Error("Cannot sign: keys unavailable");
    }

    try {
      // Create spend condition for this account
      const spendCondition = await createSinglePKHSpendCondition(accountKey.public_key);

      // Calculate note data hash for the spend condition
      const noteDataHash = await calculateNoteDataHash(spendCondition);

      // TODO: Query actual UTXOs from blockchain via RPC
      // For now, create a mock V1 UTXO for testing purposes
      // This will be replaced with real balance query when RPC is ready
      const mockNote: Note = {
        originPage: 0,
        nameFirst: digestBytesToString(new Uint8Array(40).fill(0)), // Mock 40-byte name as base58 string
        nameLast: digestBytesToString(new Uint8Array(40).fill(1)),  // Mock 40-byte name as base58 string
        noteDataHash: digestBytesToString(noteDataHash),            // Note data hash as base58 string
        assets: amount + fee + 1000, // Ensure enough for tx + change
      };

      // Build and sign the transaction
      const constructedTx = await buildPayment(
        mockNote,
        to, // Recipient PKH digest string
        amount,
        accountKey.public_key, // For creating spend condition
        fee,
        accountKey.private_key
      );

      // Return transaction ID as digest string
      // TODO: Broadcast transaction via RPC
      // await rpcClient.broadcastTransaction(constructedTx.rawTx);

      return constructedTx.txId;
    } finally {
      // Clean up WASM memory
      accountKey.free();
      masterKey.free();
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
  async getCachedTransactions(accountAddress: string): Promise<import('./types').CachedTransaction[]> {
    const result = await chrome.storage.local.get([STORAGE_KEYS.TRANSACTION_CACHE]);
    const cache: import('./types').TransactionCache = result[STORAGE_KEYS.TRANSACTION_CACHE] || {};
    return cache[accountAddress] || [];
  }

  /**
   * Updates the last sync timestamp for an account
   */
  async updateLastSync(accountAddress: string): Promise<void> {
    const result = await chrome.storage.local.get([STORAGE_KEYS.LAST_TX_SYNC]);
    const timestamps: import('./types').LastSyncTimestamps = result[STORAGE_KEYS.LAST_TX_SYNC] || {};

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
    const timestamps: import('./types').LastSyncTimestamps = result[STORAGE_KEYS.LAST_TX_SYNC] || {};
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
