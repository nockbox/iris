import { beforeEach, describe, expect, it, vi } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
  decryptGCM: vi.fn(),
  deriveKeyPBKDF2: vi.fn(async () => ({ key: {} as CryptoKey, salt: new Uint8Array() })),
  encryptGCM: vi.fn(async () => ({ iv: new Uint8Array(), ct: new Uint8Array() })),
}));

vi.mock('./webcrypto', () => ({
  PBKDF2_ITERATIONS: 1,
  rand: (length: number) => new Uint8Array(length),
  deriveKeyPBKDF2: cryptoMocks.deriveKeyPBKDF2,
  decryptGCM: cryptoMocks.decryptGCM,
  encryptGCM: cryptoMocks.encryptGCM,
}));

vi.mock('./wallet-crypto', () => ({
  generateMnemonic: vi.fn(() => 'generated mnemonic'),
  deriveAddress: vi.fn(async () => 'account'),
  deriveAddressFromMaster: vi.fn(async () => 'account'),
  validateMnemonic: vi.fn(() => true),
}));

vi.mock('@nockbox/iris-sdk', () => ({
  PROVIDER_METHODS: {},
  DEFAULT_COINBASE_TIMELOCK_BLOCKS: 100,
  DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS: {},
  MIN_BRIDGE_AMOUNT_NOCK: 1,
  NOCK_TO_NICKS: 1,
  ZORP_BRIDGE_ADDRESSES: [],
  ZORP_BRIDGE_THRESHOLD: 1,
  buildBridgeTransaction: vi.fn(),
  validateBridgeTransaction: vi.fn(),
}));

vi.mock('@nockbox/iris-sdk/wasm', () => ({ guard: {} }));
vi.mock('./sdk-wasm.js', () => ({ default: {}, initWasm: vi.fn(), wasm: {} }));

import { Vault } from './vault';

const ENCRYPTED_VAULT = {
  version: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1, salt: [] },
  cipher: { alg: 'AES-GCM', iv: [], ct: [] },
};
const DECRYPTED_VAULT = JSON.stringify({
  version: 2,
  seedAccounts: [
    {
      id: 'seed',
      name: 'Wallet 1',
      type: 'mnemonic',
      mnemonic: 'test mnemonic',
      createdAt: 1,
      accounts: [{ name: 'Wallet 1', address: 'account', index: 0 }],
    },
  ],
});
const DECRYPTED_LEGACY_VAULT = JSON.stringify({
  mnemonic: 'test mnemonic',
  accounts: [{ name: 'Wallet 1', address: 'account', index: 0 }],
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Vault lifecycle ordering', () => {
  beforeEach(() => {
    cryptoMocks.decryptGCM.mockReset();
    cryptoMocks.deriveKeyPBKDF2.mockClear();
    cryptoMocks.encryptGCM.mockReset();
    cryptoMocks.encryptGCM.mockResolvedValue({ iv: new Uint8Array(), ct: new Uint8Array() });
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ enc: ENCRYPTED_VAULT })),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
          clear: vi.fn(async () => undefined),
        },
      },
    });
  });

  it('does not let a slow password unlock undo a later lock', async () => {
    const decrypted = deferred<string>();
    cryptoMocks.decryptGCM.mockReturnValueOnce(decrypted.promise);
    const vault = new Vault();

    const unlock = vault.unlock('password');
    await vi.waitFor(() => expect(cryptoMocks.decryptGCM).toHaveBeenCalledOnce());
    await vault.lock();
    decrypted.resolve(DECRYPTED_VAULT);

    await expect(unlock).resolves.toMatchObject({ error: expect.anything() });
    expect(vault.isLocked()).toBe(true);
    expect(vault.getCurrentAccount()).toBeNull();
  });

  it('does not let a slow cached-key unlock undo a later reset', async () => {
    const decrypted = deferred<string>();
    cryptoMocks.decryptGCM.mockReturnValueOnce(decrypted.promise);
    const vault = new Vault();

    const unlock = vault.unlockWithKey({} as CryptoKey);
    await vi.waitFor(() => expect(cryptoMocks.decryptGCM).toHaveBeenCalledOnce());
    await vault.reset();
    decrypted.resolve(DECRYPTED_VAULT);

    await expect(unlock).resolves.toMatchObject({ error: expect.anything() });
    expect(vault.isLocked()).toBe(true);
    expect(vault.getCurrentAccount()).toBeNull();
    expect(chrome.storage.local.clear).toHaveBeenCalledOnce();
  });

  it('admits only one password or cached-key unlock attempt at a time', async () => {
    const decrypted = deferred<string>();
    cryptoMocks.decryptGCM.mockReturnValueOnce(decrypted.promise);
    const vault = new Vault();

    const firstUnlock = vault.unlock('password');
    await vi.waitFor(() => expect(cryptoMocks.decryptGCM).toHaveBeenCalledOnce());
    const overlappingUnlock = vault.unlockWithKey({} as CryptoKey);

    await expect(overlappingUnlock).resolves.toMatchObject({ error: expect.anything() });
    expect(cryptoMocks.decryptGCM).toHaveBeenCalledOnce();

    decrypted.resolve(DECRYPTED_VAULT);
    await expect(firstUnlock).resolves.toMatchObject({ ok: true, address: 'account' });
    expect(vault.isLocked()).toBe(false);
    expect(vault.getCurrentAccount()?.address).toBe('account');
  });

  it('keeps provisional decrypted metadata private until migration persistence finishes', async () => {
    cryptoMocks.decryptGCM.mockResolvedValueOnce(DECRYPTED_LEGACY_VAULT);
    const encrypted = deferred<{
      iv: Uint8Array<ArrayBuffer>;
      ct: Uint8Array<ArrayBuffer>;
    }>();
    cryptoMocks.encryptGCM.mockReturnValueOnce(encrypted.promise);
    const vault = new Vault();

    const unlock = vault.unlock('password');
    await vi.waitFor(() => expect(cryptoMocks.encryptGCM).toHaveBeenCalledOnce());

    expect(vault.isLocked()).toBe(true);
    expect(vault.getCurrentAccount()).toBeNull();
    expect(vault.getAccounts()).toEqual([]);
    expect(vault.getSeedSources()).toEqual([]);
    await expect(vault.getAddressSafe()).resolves.toBe('');

    encrypted.resolve({ iv: new Uint8Array(), ct: new Uint8Array() });
    await expect(unlock).resolves.toMatchObject({ ok: true, address: 'account' });
    expect(vault.getCurrentAccount()?.address).toBe('account');
  });

  it('treats an unlock request as idempotent after session restore already unlocked', async () => {
    cryptoMocks.decryptGCM.mockResolvedValueOnce(DECRYPTED_VAULT);
    const vault = new Vault();

    await expect(vault.unlockWithKey({} as CryptoKey)).resolves.toMatchObject({
      ok: true,
      address: 'account',
    });
    await expect(vault.unlock('password')).resolves.toMatchObject({
      ok: true,
      address: 'account',
    });
    expect(cryptoMocks.decryptGCM).toHaveBeenCalledOnce();
  });

  it('orders a slow encrypted-vault header save before reset clears storage', async () => {
    cryptoMocks.decryptGCM.mockResolvedValueOnce(DECRYPTED_VAULT);
    const vault = new Vault();
    await expect(vault.unlock('password')).resolves.toMatchObject({ ok: true });

    const encrypted = deferred<{
      iv: Uint8Array<ArrayBuffer>;
      ct: Uint8Array<ArrayBuffer>;
    }>();
    cryptoMocks.encryptGCM.mockReturnValueOnce(encrypted.promise);
    const rename = vault.renameAccount('account', 'Renamed');
    await vi.waitFor(() => expect(cryptoMocks.encryptGCM).toHaveBeenCalledOnce());

    const reset = vault.reset();
    encrypted.resolve({ iv: new Uint8Array(), ct: new Uint8Array() });
    await expect(rename).rejects.toThrow(/lifecycle changed/i);
    await expect(reset).resolves.toEqual({ ok: true });

    expect(chrome.storage.local.clear).toHaveBeenCalledOnce();
    const vaultHeaderWrites = vi
      .mocked(chrome.storage.local.set)
      .mock.calls.filter(([value]) => Object.prototype.hasOwnProperty.call(value, 'enc'));
    expect(vaultHeaderWrites).toHaveLength(0);
  });

  it('does not let a slow setup publish after a later lock', async () => {
    const encrypted = deferred<{
      iv: Uint8Array<ArrayBuffer>;
      ct: Uint8Array<ArrayBuffer>;
    }>();
    cryptoMocks.encryptGCM.mockReturnValueOnce(encrypted.promise);
    const vault = new Vault();

    const setup = vault.setup('password');
    await vi.waitFor(() => expect(cryptoMocks.encryptGCM).toHaveBeenCalledOnce());
    await vault.lock();
    encrypted.resolve({ iv: new Uint8Array(), ct: new Uint8Array() });

    await expect(setup).resolves.toEqual({ error: expect.anything() });
    expect(vault.isLocked()).toBe(true);
    expect(vault.getAccounts()).toEqual([]);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not let a slow setup recreate storage after reset', async () => {
    const encrypted = deferred<{
      iv: Uint8Array<ArrayBuffer>;
      ct: Uint8Array<ArrayBuffer>;
    }>();
    cryptoMocks.encryptGCM.mockReturnValueOnce(encrypted.promise);
    const vault = new Vault();

    const setup = vault.setup('password');
    await vi.waitFor(() => expect(cryptoMocks.encryptGCM).toHaveBeenCalledOnce());
    await vault.reset();
    encrypted.resolve({ iv: new Uint8Array(), ct: new Uint8Array() });

    await expect(setup).resolves.toEqual({ error: expect.anything() });
    expect(chrome.storage.local.clear).toHaveBeenCalledOnce();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
