/**
 * RPC/network config: defaults and effective config from storage.
 * Used by vault, popup (sync), background (dApp grpcEndpoint), and RpcSettingsScreen.
 */

import { STORAGE_KEYS, RPC_ENDPOINT } from './constants';

/** Tx engine settings (matches wasm.TxEngineSettings). Stored directly, used as-is. */
export interface TxEngineSettings {
  tx_engine_version: 0 | 1 | 2;
  tx_engine_patch: number;
  min_fee: string;
  cost_per_word: string;
  witness_word_div: number;
}

/**
 * Activation heights for tx engine settings.
 * Keys are block heights; at that height and above, use the corresponding settings.
 */
export type TxEngineActivationHeights = Record<number, TxEngineSettings>;

export interface RpcConfig {
  rpcUrl: string;
  networkName: string;
  blockExplorerUrl: string;
  /** Block height -> tx engine settings. At height H, use the settings for the largest key <= H. */
  txEngineActivationHeights?: TxEngineActivationHeights;
  /** Coinbase maturity in blocks (e.g. 100 for mainnet, different for testnet). */
  coinbaseTimelockBlocks?: number;
}

/** Stored config is partial; unset keys fall back to defaults */
export type StoredRpcConfig = Partial<RpcConfig>;

const DEFAULT_NETWORK_NAME = 'Nockchain Mainnet';

/** Block explorer URL constants (single source of truth) */
export const NOCKSCAN_URL = 'https://nockscan.net/';
export const NOCKBLOCKS_URL = 'https://nockblocks.com/';

/** Allowed block explorer URLs (dropdown options) */
export const BLOCK_EXPLORER_OPTIONS = [
  { value: NOCKSCAN_URL, label: 'NockScan' },
  { value: NOCKBLOCKS_URL, label: 'NockBlocks' },
] as const;

const DEFAULT_BLOCK_EXPLORER_URL = NOCKSCAN_URL;

/** Default V1 tx engine settings (mainnet: v1 from 39000). */
const V1_TX_ENGINE_SETTINGS: TxEngineSettings = {
  tx_engine_version: 1,
  tx_engine_patch: 0,
  min_fee: '256',
  cost_per_word: String(1 << 15),
  witness_word_div: 1,
};

/** Bythos tx engine (v1 patch 1): witness_word_div 4, min_fee 256 */
const BYTHOS_TX_ENGINE_SETTINGS: TxEngineSettings = {
  tx_engine_version: 1,
  tx_engine_patch: 1,
  min_fee: '256',
  cost_per_word: String(1 << 14),
  witness_word_div: 4,
};

// Intentionally don't have a tx engine at block 0, because we do not support v0 just yet.
const DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS: TxEngineActivationHeights = {
  39000: V1_TX_ENGINE_SETTINGS,
  54000: BYTHOS_TX_ENGINE_SETTINGS,
};

/** Default coinbase timelock (mainnet maturity) */
const DEFAULT_COINBASE_TIMELOCK_BLOCKS = 100;

/** Default RPC config (used when nothing is stored, and for "Reset to default") */
export const defaultRpcConfig: RpcConfig = {
  rpcUrl: RPC_ENDPOINT,
  networkName: DEFAULT_NETWORK_NAME,
  blockExplorerUrl: DEFAULT_BLOCK_EXPLORER_URL,
  txEngineActivationHeights: DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS,
  coinbaseTimelockBlocks: DEFAULT_COINBASE_TIMELOCK_BLOCKS,
};

function ensureHttps(url: string): string {
  const trimmed = url.trim();
  const toNormalize = trimmed || RPC_ENDPOINT.trim();
  if (!toNormalize) return RPC_ENDPOINT;
  if (/^https?:\/\//i.test(toNormalize)) return toNormalize;
  return `https://${toNormalize}`;
}

/**
 * Get the effective RPC config: stored values merged with defaults.
 * Used when loading the RPC settings form and when resolving endpoint for use.
 */
export async function getEffectiveRpcConfig(): Promise<RpcConfig> {
  const stored = await new Promise<StoredRpcConfig | undefined>(resolve => {
    chrome.storage.local.get([STORAGE_KEYS.RPC_CONFIG], result => {
      resolve(result[STORAGE_KEYS.RPC_CONFIG] as StoredRpcConfig | undefined);
    });
  });

  if (!stored || Object.keys(stored).length === 0) {
    return {
      ...defaultRpcConfig,
      rpcUrl: ensureHttps(defaultRpcConfig.rpcUrl),
    };
  }

  const storedExplorer = stored.blockExplorerUrl?.trim();
  const blockExplorerUrl =
    storedExplorer && BLOCK_EXPLORER_OPTIONS.some(o => o.value === storedExplorer)
      ? storedExplorer
      : defaultRpcConfig.blockExplorerUrl;

  const merged: RpcConfig = {
    rpcUrl: stored.rpcUrl != null && stored.rpcUrl !== '' ? stored.rpcUrl : defaultRpcConfig.rpcUrl,
    networkName: stored.networkName ?? defaultRpcConfig.networkName,
    blockExplorerUrl,
    txEngineActivationHeights:
      stored.txEngineActivationHeights && Object.keys(stored.txEngineActivationHeights).length > 0
        ? stored.txEngineActivationHeights
        : defaultRpcConfig.txEngineActivationHeights,
    coinbaseTimelockBlocks:
      stored.coinbaseTimelockBlocks ?? defaultRpcConfig.coinbaseTimelockBlocks,
  };
  merged.rpcUrl = ensureHttps(merged.rpcUrl);
  return merged;
}

/**
 * Get the effective RPC endpoint URL (for createBrowserClient and dApp grpcEndpoint).
 */
export async function getEffectiveRpcEndpoint(): Promise<string> {
  const config = await getEffectiveRpcConfig();
  return config.rpcUrl;
}

/**
 * Save RPC config to storage. Pass partial to only override specific keys.
 */
export async function saveRpcConfig(config: StoredRpcConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.RPC_CONFIG]: config });
}

/**
 * Clear stored RPC config so effective config reverts to defaults.
 */
export async function clearRpcConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.RPC_CONFIG);
}

/**
 * Resolve TxEngineSettings for a given block height.
 * Returns the settings for the largest activation height <= blockHeight.
 * Use directly with wasm.TxBuilder.
 */
export async function getTxEngineSettingsForHeight(
  blockHeight: number
): Promise<TxEngineSettings> {
  const config = await getEffectiveRpcConfig();
  const heights =
    config.txEngineActivationHeights ??
    defaultRpcConfig.txEngineActivationHeights ??
    DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS;
  const sorted = Object.keys(heights)
    .map(Number)
    .filter(h => h <= blockHeight)
    .sort((a, b) => b - a);
  const best = sorted[0];
  if (best === undefined) {
    throw new Error(`No tx engine available for height ${blockHeight}`);
  }
  return heights[best];
}
