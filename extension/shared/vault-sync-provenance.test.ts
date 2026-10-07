import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredNote, WalletTransaction } from './types';

const mocks = vi.hoisted(() => ({
  queryV1Balance: vi.fn(),
  encryptGCM: vi.fn(async () => ({ iv: new Uint8Array(), ct: new Uint8Array() })),
  rpcConfig: undefined as Record<string, unknown> | undefined,
}));

vi.mock('./balance-query', () => ({ queryV1Balance: mocks.queryV1Balance }));
vi.mock('./rpc-client-browser', () => ({ createBrowserClient: vi.fn(() => ({})) }));
vi.mock('./nockblocks-client.js', () => ({
  isNockblocksConfigured: vi.fn(() => false),
  createNockblocksClient: vi.fn(),
}));
vi.mock('./webcrypto', () => ({
  PBKDF2_ITERATIONS: 1,
  rand: (length: number) => new Uint8Array(length),
  deriveKeyPBKDF2: vi.fn(),
  decryptGCM: vi.fn(),
  encryptGCM: mocks.encryptGCM,
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
import { defaultRpcConfig, getRpcNetworkIdentity } from './rpc-config';
import { generateNoteId } from './utxo-utils';

const ACCOUNT = 'account';
const FIRST = 'first';
const LAST = 'last';
const NOTE_ID = generateNoteId(FIRST, LAST);

function storedNote(state: StoredNote['state'] = 'available', pendingTxId?: string): StoredNote {
  return {
    noteId: NOTE_ID,
    accountAddress: ACCOUNT,
    sourceHash: 'source',
    originPage: 1,
    assets: 100,
    nameFirst: FIRST,
    nameLast: LAST,
    noteDataHashBase58: 'data',
    protoNote: {},
    state,
    pendingTxId,
    discoveredAt: 1,
  };
}

function balance(blockHeight: number, nameFirst = FIRST, nameLast = LAST) {
  return {
    blockHeight,
    totalNock: 100,
    utxoCount: 1,
    simpleNotes: [
      {
        nameFirstBase58: nameFirst,
        nameLastBase58: nameLast,
        nameFirst: new Uint8Array(),
        nameLast: new Uint8Array(),
        sourceHash: new Uint8Array(),
        originPage: 1n,
        assets: 100,
        noteDataHashBase58: 'data',
        protoNote: {},
      },
    ],
    coinbaseNotes: [],
  };
}

function transaction(
  id: string,
  status: WalletTransaction['status'],
  inputNoteIds: string[] = []
): WalletTransaction {
  return {
    id,
    accountAddress: ACCOUNT,
    direction: 'outgoing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status,
    inputNoteIds,
    amount: 10,
    fee: 1,
    expectedChange: 89,
  };
}

type VaultInternals = {
  state: {
    locked: boolean;
    accounts: Array<{ name: string; address: string; index: number }>;
    currentAccountIndex: number;
    enc: null;
  };
  encryptionKey: CryptoKey | null;
  utxoStore: Record<string, { notes: StoredNote[]; version: number; blockHeight: number }>;
  walletTxStore: Record<string, WalletTransaction[]>;
  accountSyncState: Record<string, ReturnType<Vault['getAccountSyncState']>>;
  cachedBalances: Record<string, number>;
};

function unlockedVault(options: {
  note?: StoredNote;
  transactions?: WalletTransaction[];
  rpcNetworkIdentity?: string;
  blockHeight?: number;
}): Vault {
  const vault = new Vault();
  const internals = vault as unknown as VaultInternals;
  internals.state = {
    locked: false,
    accounts: [{ name: 'Wallet', address: ACCOUNT, index: 0 }],
    currentAccountIndex: 0,
    enc: null,
  };
  internals.encryptionKey = {} as CryptoKey;
  internals.utxoStore = {
    [ACCOUNT]: {
      notes: options.note ? [options.note] : [],
      version: 1,
      blockHeight: options.blockHeight ?? 50,
    },
  };
  internals.walletTxStore = { [ACCOUNT]: options.transactions ?? [] };
  internals.accountSyncState = {
    [ACCOUNT]: {
      accountAddress: ACCOUNT,
      lastSyncedHeight: options.blockHeight ?? 50,
      lastSyncedAt: 1,
      rpcNetworkIdentity: options.rpcNetworkIdentity,
    },
  };
  internals.cachedBalances = { [ACCOUNT]: 100 };
  return vault;
}

describe('Vault UTXO network provenance', () => {
  beforeEach(() => {
    mocks.rpcConfig = undefined;
    mocks.queryV1Balance.mockReset();
    mocks.encryptGCM.mockReset();
    mocks.encryptGCM.mockResolvedValue({ iv: new Uint8Array(), ct: new Uint8Array() });
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((_: unknown, callback?: (value: unknown) => void) => {
            const value = mocks.rpcConfig ? { rpcConfig: mocks.rpcConfig } : {};
            if (callback) {
              callback(value);
              return undefined;
            }
            return Promise.resolve(value);
          }),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
          clear: vi.fn(async () => undefined),
        },
      },
    });
  });

  it('advances the coherent UTXO tip even when the note set is unchanged', async () => {
    const identity = getRpcNetworkIdentity(defaultRpcConfig);
    const vault = unlockedVault({
      note: storedNote(),
      rpcNetworkIdentity: identity,
      blockHeight: 50,
    });
    mocks.queryV1Balance.mockResolvedValue(balance(100));

    await vault.syncAccountUTXOs(ACCOUNT, { skipHistory: true });

    expect(vault.getAccountBlockHeight(ACCOUNT)).toBe(100);
    expect(vault.getAccountSyncState(ACCOUNT)).toMatchObject({
      rpcNetworkIdentity: identity,
      utxoSyncInProgress: false,
      lastSyncedHeight: 100,
    });
  });

  it('adopts a legacy default-network cache without abandoning its pending transaction', async () => {
    const pending = transaction('pending', 'created', [NOTE_ID]);
    const vault = unlockedVault({
      note: storedNote('in_flight', pending.id),
      transactions: [pending],
    });
    mocks.queryV1Balance.mockResolvedValue(balance(100));

    await vault.syncAccountUTXOs(ACCOUNT, { skipHistory: true });

    expect(pending).toMatchObject({ status: 'created', expectedChange: 89 });
    expect(vault.getAccountNotes(ACCOUNT)[0]).toMatchObject({
      state: 'in_flight',
      pendingTxId: pending.id,
    });
    expect(vault.getAccountSyncState(ACCOUNT).rpcNetworkIdentity).toBe(
      getRpcNetworkIdentity(defaultRpcConfig)
    );
  });

  it('fresh-replaces a true network switch while preserving terminal history fields', async () => {
    const terminal = transaction('confirmed', 'confirmed', [NOTE_ID]);
    terminal.expectedChangeNoteIds = ['change'];
    const previousTerminal = structuredClone(terminal);
    const oldIdentity = getRpcNetworkIdentity({
      ...defaultRpcConfig,
      rpcUrl: 'https://old-rpc.example',
    });
    mocks.rpcConfig = { rpcUrl: 'https://new-rpc.example' };
    const vault = unlockedVault({
      note: storedNote(),
      transactions: [terminal],
      rpcNetworkIdentity: oldIdentity,
    });
    mocks.queryV1Balance.mockResolvedValue(balance(200, 'new-first', 'new-last'));

    await vault.syncAccountUTXOs(ACCOUNT, { skipHistory: true });

    expect(terminal).toEqual(previousTerminal);
    expect(vault.getAccountNotes(ACCOUNT)).toHaveLength(1);
    expect(vault.getAccountNotes(ACCOUNT)[0].noteId).toBe(generateNoteId('new-first', 'new-last'));
    expect(vault.getAccountSyncState(ACCOUNT)).toMatchObject({
      excludeTerminalHistoryFromChangeDetection: true,
      utxoSyncInProgress: false,
    });
  });

  it('does not reinterpret an ambiguous pending transaction on another network', async () => {
    const ambiguous = transaction('ambiguous', 'broadcast_pending', [NOTE_ID]);
    ambiguous.txHash = 'signed-id';
    const oldIdentity = getRpcNetworkIdentity({
      ...defaultRpcConfig,
      rpcUrl: 'https://old-rpc.example',
    });
    mocks.rpcConfig = { rpcUrl: 'https://new-rpc.example' };
    const note = storedNote('in_flight', ambiguous.id);
    const vault = unlockedVault({
      note,
      transactions: [ambiguous],
      rpcNetworkIdentity: oldIdentity,
    });
    mocks.queryV1Balance.mockResolvedValue(balance(200, 'new-first', 'new-last'));

    await expect(vault.syncAccountUTXOs(ACCOUNT, { skipHistory: true })).rejects.toThrow(
      /pending on the previously selected network/i
    );
    expect(vault.getAccountNotes(ACCOUNT)).toEqual([note]);
    expect(vault.getAccountSyncState(ACCOUNT).rpcNetworkIdentity).toBe(oldIdentity);
  });

  it('keeps the in-memory fence closed when the final coherent save fails', async () => {
    const identity = getRpcNetworkIdentity(defaultRpcConfig);
    const vault = unlockedVault({ note: storedNote(), rpcNetworkIdentity: identity });
    mocks.queryV1Balance.mockResolvedValue(balance(100));
    mocks.encryptGCM
      .mockResolvedValueOnce({ iv: new Uint8Array(), ct: new Uint8Array() })
      .mockRejectedValueOnce(new Error('storage failure'));

    await expect(vault.syncAccountUTXOs(ACCOUNT, { skipHistory: true })).rejects.toThrow(
      /storage failure/i
    );
    expect(vault.getAccountSyncState(ACCOUNT).utxoSyncInProgress).toBe(true);
    await expect(vault.accountNeedsSyncForCurrentNetwork(ACCOUNT)).resolves.toBe(true);
  });
});
