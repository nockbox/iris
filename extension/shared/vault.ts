/**
 * Vault: manages encrypted mnemonic storage and wallet state
 */

import { encryptGCM, decryptGCM, deriveKeyPBKDF2, rand } from "./webcrypto";
import { generateMnemonic, deriveAddress } from "./wallet-crypto";
import { ERROR_CODES, STORAGE_KEYS } from "./constants";

interface EncryptedData {
  iv: number[];
  ct: number[];
  salt: number[];
}

interface VaultState {
  locked: boolean;
  address: string;
  enc: EncryptedData | null;
}

export class Vault {
  private state: VaultState = {
    locked: true,
    address: "",
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
  ): Promise<{ ok: boolean; address: string } | { error: string }> {
    const words = (mnemonic || generateMnemonic()).trim();
    const addr = deriveAddress(words, 0);

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
      [STORAGE_KEYS.ADDRESS]: addr,
    });
    this.state = { locked: true, address: addr, enc: encData };

    return { ok: true, address: addr };
  }

  /**
   * Unlocks the vault with the provided password
   */
  async unlock(
    password: string
  ): Promise<{ ok: boolean; address: string } | { error: string }> {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ENCRYPTED_VAULT,
      STORAGE_KEYS.ADDRESS,
    ]);
    const enc = stored[STORAGE_KEYS.ENCRYPTED_VAULT] as
      | EncryptedData
      | undefined;
    const address = stored[STORAGE_KEYS.ADDRESS] as string | undefined;

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

      this.state = { locked: false, address: address || "", enc };
      return { ok: true, address: address || "" };
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
   * Gets the address (only when unlocked)
   */
  async getAddress(): Promise<string> {
    return this.state.address;
  }

  /**
   * Gets the address safely (even when locked, from storage)
   */
  async getAddressSafe(): Promise<string> {
    if (this.state.address) {
      return this.state.address;
    }
    const stored = await chrome.storage.local.get(STORAGE_KEYS.ADDRESS);
    return (stored[STORAGE_KEYS.ADDRESS] as string) || "";
  }

  /**
   * Signs a message
   * TODO: Replace with real signing using WASM and derived private key
   */
  async signMessage(params: any): Promise<string> {
    // Placeholder: returns base64-encoded string
    // TODO: Implement Schnorr signature over CheetahPoint via WASM
    const msg = params?.[0] ?? "";
    return btoa("signed:" + msg);
  }
}
