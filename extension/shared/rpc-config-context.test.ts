import { describe, expect, it, vi } from 'vitest';
import type { TxEngineSettings } from '@nockbox/iris-sdk/wasm';

vi.mock('@nockbox/iris-sdk', () => ({
  PROVIDER_METHODS: {},
  DEFAULT_COINBASE_TIMELOCK_BLOCKS: 100,
  DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS: {
    0: {
      tx_engine_version: 1,
      tx_engine_patch: 0,
      min_fee: '1',
      cost_per_word: '1',
      witness_word_div: 1,
    },
  },
}));

import {
  assertRpcNetworkIdentity,
  getRpcNetworkIdentity,
  getTransactionContextFingerprint,
  type RpcConfig,
  type TxEngineActivationHeights,
} from './rpc-config';

function settings(patch: number, minimumFee: string): TxEngineSettings {
  return {
    tx_engine_version: 1,
    tx_engine_patch: patch,
    min_fee: minimumFee,
    cost_per_word: '1',
    witness_word_div: 1,
  } as TxEngineSettings;
}

function config(
  overrides: Partial<RpcConfig> = {},
  activations: TxEngineActivationHeights = {
    0: settings(0, '1'),
    100: settings(1, '2'),
  }
): RpcConfig {
  return {
    rpcUrl: 'https://rpc.example',
    networkName: 'Testnet',
    blockExplorerUrl: 'https://explorer.example',
    coinbaseTimelockBlocks: 100,
    txEngineActivationHeights: activations,
    ...overrides,
  };
}

describe('transaction context fingerprints', () => {
  it('survives ordinary height advances but changes across an activation', () => {
    expect(getTransactionContextFingerprint(config(), 50)).toBe(
      getTransactionContextFingerprint(config(), 99)
    );
    expect(getTransactionContextFingerprint(config(), 99)).not.toBe(
      getTransactionContextFingerprint(config(), 100)
    );
  });

  it('binds RPC, network, timelock, and the complete activation schedule', () => {
    const baseline = getTransactionContextFingerprint(config(), 50);

    expect(
      getTransactionContextFingerprint(config({ rpcUrl: 'https://other-rpc.example' }), 50)
    ).not.toBe(baseline);
    expect(getTransactionContextFingerprint(config({ networkName: 'Other testnet' }), 50)).not.toBe(
      baseline
    );
    expect(getTransactionContextFingerprint(config({ coinbaseTimelockBlocks: 200 }), 50)).not.toBe(
      baseline
    );
    expect(
      getTransactionContextFingerprint(
        config({}, { 0: settings(0, '1'), 100: settings(2, '2') }),
        50
      )
    ).not.toBe(baseline);
  });

  it('is canonical across URL and activation-map insertion ordering', () => {
    const forward = config({}, { 0: settings(0, '1'), 100: settings(1, '2') });
    const reverse = config(
      { rpcUrl: 'https://rpc.example/' },
      { 100: settings(1, '2'), 0: settings(0, '1') }
    );

    expect(getTransactionContextFingerprint(forward, 50)).toBe(
      getTransactionContextFingerprint(reverse, 50)
    );
    expect(
      getTransactionContextFingerprint(
        { ...forward, blockExplorerUrl: 'https://unrelated-explorer.example' },
        50
      )
    ).toBe(getTransactionContextFingerprint(forward, 50));
  });
});

describe('RPC network cache identity', () => {
  it('normalizes equivalent endpoints and excludes explorer-only settings', () => {
    const baseline = getRpcNetworkIdentity(config());
    expect(getRpcNetworkIdentity(config({ rpcUrl: 'https://rpc.example/' }))).toBe(baseline);
    expect(
      getRpcNetworkIdentity(config({ blockExplorerUrl: 'https://other-explorer.example' }))
    ).toBe(baseline);
  });

  it('requires resync after an endpoint change but not a label-only rename', () => {
    const synced = getRpcNetworkIdentity(config());
    const changedEndpoint = getRpcNetworkIdentity(config({ rpcUrl: 'https://other-rpc.example' }));
    const changedNetwork = getRpcNetworkIdentity(config({ networkName: 'Other testnet' }));

    expect(() => assertRpcNetworkIdentity(synced, changedEndpoint)).toThrow(/must be synced/i);
    expect(changedNetwork).toBe(synced);
  });

  it('requires a resync for legacy caches without provenance', () => {
    expect(() => assertRpcNetworkIdentity(undefined, getRpcNetworkIdentity(config()))).toThrow(
      /must be synced/i
    );
  });
});
