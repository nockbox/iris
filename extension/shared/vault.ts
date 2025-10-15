/**
 * Vault: manages encrypted mnemonic storage and wallet state
 */

import { encryptGCM, decryptGCM, deriveKeyPBKDF2, rand } from "./webcrypto";
import { generateMnemonic, deriveAddress, validateMnemonic } from "./wallet-crypto";
import { ERROR_CODES, STORAGE_KEYS } from "./constants";
import { Account } from "./types";

interface EncryptedData {
  iv: number[];
  ct: number[];
  salt: number[];
}

interface VaultState {
  locked: boolean;
  accounts: Account[];
  currentAccountIndex: number;
  enc: EncryptedData | null;
}

export class Vault {
  private state: VaultState = {
    locked: true,
    accounts: [],
    currentAccountIndex: 0,
    enc: null,
  };

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
      address: deriveAddress(words, 0),
      index: 0,
    };

    const { key, salt: keySalt } = await deriveKeyPBKDF2(password, rand(16));
    const { iv, ct, salt } = await encryptGCM(
      key,
      keySalt,
      new TextEncoder().encode(words)
    );

    // Store as arrays for chrome.storage compatibility
    const encData: EncryptedData = {
      iv: Array.from(iv), // Initialization Vector
      ct: Array.from(ct), // Ciphertext
      salt: Array.from(salt),
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.ENCRYPTED_VAULT]: encData,
      [STORAGE_KEYS.ACCOUNTS]: [firstAccount],
      [STORAGE_KEYS.CURRENT_ACCOUNT_INDEX]: 0,
    });

    this.state = {
      locked: true,
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
  ): Promise<{ ok: boolean; address: string; accounts: Account[] } | { error: string }> {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ENCRYPTED_VAULT,
      STORAGE_KEYS.ACCOUNTS,
      STORAGE_KEYS.CURRENT_ACCOUNT_INDEX,
    ]);
    const enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as
      | EncryptedData
      | undefined;
    const accounts = (stored[STORAGE_KEYS.ACCOUNTS] as Account[] | undefined) || [];
    const currentAccountIndex = (stored[STORAGE_KEYS.CURRENT_ACCOUNT_INDEX] as number | undefined) || 0;

    if (!enc) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    try {
      const { key } = await deriveKeyPBKDF2(password, new Uint8Array(enc.salt));
      const pt = await decryptGCM(
        key,
        new Uint8Array(enc.iv),
        new Uint8Array(enc.ct)
      ).catch(() => null);

      if (!pt) {
        return { error: ERROR_CODES.BAD_PASSWORD };
      }

      this.state = {
        locked: false,
        accounts,
        currentAccountIndex,
        enc
      };

      const currentAccount = accounts[currentAccountIndex] || accounts[0];
      return { ok: true, address: currentAccount?.address || "", accounts };
    } catch (err) {
      return { error: ERROR_CODES.BAD_PASSWORD };
    }
  }

  /**
   * Locks the vault
   */
  async lock(): Promise<{ ok: boolean }> {
    this.state.locked = true;
    return { ok: true };
  }

  /**
   * Returns whether the vault is currently locked
   */
  async isLocked(): Promise<boolean> {
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
  async getAddress(): Promise<string> {
    const account = this.getCurrentAccount();
    return account?.address || "";
  }

  /**
   * Gets all accounts
   */
  async getAccounts(): Promise<Account[]> {
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

    if (!this.state.enc) {
      return { error: ERROR_CODES.NO_VAULT };
    }

    // Get the encrypted mnemonic and decrypt it
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.ENCRYPTED_VAULT);
      const enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as EncryptedData;

      // We need to decrypt the mnemonic to derive a new account
      // For now, we'll return an error since we need the password
      // This will need to be called with the mnemonic in memory after unlock
      return { error: "CREATE_ACCOUNT_NOT_IMPLEMENTED" };
    } catch (err) {
      return { error: ERROR_CODES.NO_VAULT };
    }
  }

  /**
   * Creates a new account with the decrypted mnemonic (called after unlock with mnemonic in memory)
   */
  async createAccountWithMnemonic(mnemonic: string, name?: string): Promise<{ ok: boolean; account: Account } | { error: string }> {
    if (this.state.locked) {
      return { error: ERROR_CODES.LOCKED };
    }

    const nextIndex = this.state.accounts.length;
    const accountName = name || `Account ${nextIndex + 1}`;

    const newAccount: Account = {
      name: accountName,
      address: deriveAddress(mnemonic, nextIndex),
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
      return { error: "INVALID_ACCOUNT_INDEX" };
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
      return { error: "INVALID_ACCOUNT_INDEX" };
    }

    this.state.accounts[index].name = name;

    await chrome.storage.local.set({
      [STORAGE_KEYS.ACCOUNTS]: this.state.accounts,
    });

    return { ok: true };
  }

  /**
   * Signs a message
   * TODO: Replace with real signing using WASM and derived private key
   */
  async signMessage(params: unknown): Promise<string> {
    // Placeholder: returns base64-encoded string
    // TODO: Implement Schnorr signature over CheetahPoint via WASM
    const msg = (Array.isArray(params) ? params[0] : params) ?? "";
    return btoa("signed:" + String(msg));
  }
}
