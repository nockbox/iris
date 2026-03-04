/**
 * RPC/network config: defaults and effective config from storage.
 * Used by vault, popup (sync), background (dApp grpcEndpoint), and RpcSettingsScreen.
 */

import { STORAGE_KEYS, RPC_ENDPOINT } from './constants';

/**
 * Activation heights for tx engine versions.
 * Keys are block heights; at that height and above, use the corresponding engine.
 * Example: { 0: "tx-engine-0", 24000: "tx-engine-1", 54000: "tx-engine-bythos" }
 */
export type TxEngineActivationHeights = Record<number, string>;

export interface RpcConfig {
  rpcUrl: string;
  networkName: string;
  blockExplorerUrl: string;
  /** Block height -> tx engine name. At height H, use the engine for the largest key <= H. */
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

/** Default tx engine activation (mainnet: v1 from genesis) */
const DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS: TxEngineActivationHeights = {
  0: 'tx-engine-1',
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
 * Resolve which tx engine to use at a given block height.
 * Returns the engine name for the largest activation height <= currentHeight.
 */
export function getTxEngineNameForHeight(
  activationHeights: TxEngineActivationHeights,
  currentHeight: number
): string {
  const heights = Object.keys(activationHeights)
    .map(Number)
    .filter(h => h <= currentHeight)
    .sort((a, b) => b - a);
  const best = heights[0];
  return best !== undefined ? activationHeights[best] : 'tx-engine-1';
}

/**
 * Parse tx engine name to (version, patch).
 * Supports: tx-engine-0, tx-engine-1, tx-engine-2, tx-engine-bythos, etc.
 */
export function parseTxEngineName(name: string): { version: 0 | 1 | 2; patch: number } {
  const trimmed = (name || '').trim().toLowerCase();
  if (trimmed === 'tx-engine-bythos') {
    return { version: 2, patch: 0 };
  }
  const match = trimmed.match(/^tx-engine-(\d+)(?:\.(\d+))?$/);
  if (match) {
    const version = Math.min(2, Math.max(0, parseInt(match[1], 10))) as 0 | 1 | 2;
    const patch = match[2] ? parseInt(match[2], 10) : 0;
    return { version, patch };
  }
  return { version: 1, patch: 0 };
}

/**
 * Resolve TxEngineSettings for a given block height.
 * Returns settings suitable for wasm.TxBuilder constructor.
 */
export async function getTxEngineSettingsForHeight(
  blockHeight: number,
  costPerWord: number
): Promise<{ tx_engine_version: 0 | 1 | 2; tx_engine_patch: number; min_fee: string; cost_per_word: string; witness_word_div: number }> {
  const config = await getEffectiveRpcConfig();
  const heights = config.txEngineActivationHeights ?? defaultRpcConfig.txEngineActivationHeights ?? DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS;
  const engineName = getTxEngineNameForHeight(heights, blockHeight);
  const { version, patch } = parseTxEngineName(engineName);
  return {
    tx_engine_version: version,
    tx_engine_patch: patch,
    min_fee: '0',
    cost_per_word: String(costPerWord),
    witness_word_div: 1,
  };
}
