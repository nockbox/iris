/**
 * RPC/network config: defaults and effective config from storage.
 * Used by vault, popup (sync), background (dApp grpcEndpoint), and RpcSettingsScreen.
 */

import type { Nicks, TxEngineSettings } from '@nockbox/iris-sdk/wasm';
export type { Nicks, TxEngineSettings };
import {
  DEFAULT_COINBASE_TIMELOCK_BLOCKS,
  DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS,
} from '@nockbox/iris-sdk';
import { STORAGE_KEYS, RPC_ENDPOINT } from './constants';

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

/**
 * Effective transaction semantics captured from one storage read. The
 * fingerprint intentionally excludes the current block height itself so an
 * approval remains valid while the chain advances within the same activation
 * band. Crossing an activation boundary changes the fingerprint.
 */
export type TransactionContextSnapshot = Readonly<{
  fingerprint: string;
  /** Stable endpoint + logical-network identity used to source cached UTXOs. */
  networkIdentity: string;
  rpcUrl: string;
  networkName: string;
  coinbaseTimelockBlocks: number;
  txEngineActivationHeight: number;
  nextTxEngineActivationHeight?: number;
  txEngineSettings: TxEngineSettings;
}>;

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

/**
 * Strip v0 from an activation map when building Iris **defaults** from the SDK.
 * `RpcConfig` itself can still hold v0 if something stores it; this is not a hard
 * protocol rule—today the extension simply does not ship v0 in the default map
 * until product paths support the v0 tx engine end-to-end.
 */
function walletTxEngineActivationHeights(
  heights: Record<number, TxEngineSettings>
): TxEngineActivationHeights {
  const out: TxEngineActivationHeights = {};
  for (const [height, settings] of Object.entries(heights)) {
    if (settings.tx_engine_version === 0) continue;
    out[Number(height)] = settings;
  }
  return out;
}

const DEFAULT_WALLET_TX_ENGINE_ACTIVATION_HEIGHTS = walletTxEngineActivationHeights(
  DEFAULT_TX_ENGINE_ACTIVATION_HEIGHTS
);

/** Default RPC config (used when nothing is stored, and for "Reset to default") */
export const defaultRpcConfig: RpcConfig = {
  rpcUrl: RPC_ENDPOINT,
  networkName: DEFAULT_NETWORK_NAME,
  blockExplorerUrl: DEFAULT_BLOCK_EXPLORER_URL,
  txEngineActivationHeights: DEFAULT_WALLET_TX_ENGINE_ACTIVATION_HEIGHTS,
  coinbaseTimelockBlocks: DEFAULT_COINBASE_TIMELOCK_BLOCKS,
};

/**
 * Normalize and validate an RPC endpoint.
 * HTTP remains supported for backwards compatibility with private/test nodes;
 * the settings UI requires an explicit trust acknowledgement for custom RPCs.
 */
export function normalizeRpcUrl(value: string): string {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('RPC URL must use HTTP or HTTPS');
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;

  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error('Enter a valid RPC URL');
  }

  if (parsed.username || parsed.password) {
    throw new Error('RPC URLs cannot contain credentials');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('RPC URL must use HTTP or HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function defaultNormalizedRpcUrl(): string {
  return normalizeRpcUrl(defaultRpcConfig.rpcUrl || RPC_ENDPOINT);
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
      rpcUrl: defaultNormalizedRpcUrl(),
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
  try {
    merged.rpcUrl = normalizeRpcUrl(merged.rpcUrl);
  } catch {
    merged.rpcUrl = defaultNormalizedRpcUrl();
  }
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
  const normalized: StoredRpcConfig = {
    ...config,
    ...(config.rpcUrl !== undefined ? { rpcUrl: normalizeRpcUrl(config.rpcUrl) } : {}),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.RPC_CONFIG]: normalized });
}

/**
 * Clear stored RPC config so effective config reverts to defaults.
 */
export async function clearRpcConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.RPC_CONFIG);
}

function txEngineActivationEntries(config: RpcConfig): Array<readonly [number, TxEngineSettings]> {
  const heights =
    config.txEngineActivationHeights ??
    defaultRpcConfig.txEngineActivationHeights ??
    DEFAULT_WALLET_TX_ENGINE_ACTIVATION_HEIGHTS;

  return Object.entries(heights)
    .map(([height, settings]) => [Number(height), settings] as const)
    .filter(([height]) => Number.isFinite(height))
    .sort(([a], [b]) => a - b);
}

function activeTxEngineContext(
  config: RpcConfig,
  blockHeight: number
): { activationHeight: number; settings: TxEngineSettings } {
  const eligible = txEngineActivationEntries(config).filter(([height]) => height <= blockHeight);
  const active = eligible[eligible.length - 1];
  if (!active) {
    throw new Error(`No tx engine available for height ${blockHeight}`);
  }
  return { activationHeight: active[0], settings: active[1] };
}

function canonicalizeContextValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalizeContextValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalizeContextValue(entry)])
    );
  }
  return value;
}

/**
 * Stable identity for chain-derived wallet data. A successful account sync is
 * tagged with this value; transaction builders reject untagged or mismatched
 * caches so changing RPC/network settings cannot mix notes from two chains.
 */
export function getRpcNetworkIdentity(config: RpcConfig): string {
  return JSON.stringify({
    schema: 1,
    rpcUrl: normalizeRpcUrl(config.rpcUrl || RPC_ENDPOINT),
    // The configured name is a user-editable label, not chain identity. A
    // future RPC chain/genesis ID can be added here without treating renames as
    // a destructive network switch.
  });
}

export function assertRpcNetworkIdentity(
  syncedIdentity: string | undefined,
  currentIdentity: string
): void {
  if (!syncedIdentity || syncedIdentity !== currentIdentity) {
    throw new Error('Wallet data must be synced with the current network before transacting');
  }
}

/**
 * Stable, collision-free canonical representation of the configuration that
 * can change how a transaction is built, signed, or submitted.
 */
export function getTransactionContextFingerprint(config: RpcConfig, blockHeight: number): string {
  const active = activeTxEngineContext(config, blockHeight);
  const descriptor = {
    schema: 1,
    rpcUrl: normalizeRpcUrl(config.rpcUrl || RPC_ENDPOINT),
    networkName: config.networkName,
    coinbaseTimelockBlocks: config.coinbaseTimelockBlocks ?? DEFAULT_COINBASE_TIMELOCK_BLOCKS,
    txEngineActivationHeights: txEngineActivationEntries(config).map(([height, settings]) => ({
      height,
      settings,
    })),
    activeTxEngineActivationHeight: active.activationHeight,
    activeTxEngineSettings: active.settings,
  };
  return JSON.stringify(canonicalizeContextValue(descriptor));
}

/** Capture every transaction-context value from one effective config read. */
export async function getTransactionContextSnapshot(
  blockHeight: number
): Promise<TransactionContextSnapshot> {
  const config = await getEffectiveRpcConfig();
  const active = activeTxEngineContext(config, blockHeight);
  const nextActivation = txEngineActivationEntries(config).find(([height]) => height > blockHeight);
  const txEngineSettings = Object.freeze({ ...active.settings });

  return Object.freeze({
    fingerprint: getTransactionContextFingerprint(config, blockHeight),
    networkIdentity: getRpcNetworkIdentity(config),
    rpcUrl: config.rpcUrl,
    networkName: config.networkName,
    coinbaseTimelockBlocks: config.coinbaseTimelockBlocks ?? DEFAULT_COINBASE_TIMELOCK_BLOCKS,
    txEngineActivationHeight: active.activationHeight,
    nextTxEngineActivationHeight: nextActivation?.[0],
    txEngineSettings,
  });
}

/**
 * Resolve TxEngineSettings for a given block height.
 * Returns the settings for the largest activation height <= blockHeight.
 * Use directly with wasm.TxBuilder.
 */
export async function getTxEngineSettingsForHeight(blockHeight: number): Promise<TxEngineSettings> {
  const config = await getEffectiveRpcConfig();
  return activeTxEngineContext(config, blockHeight).settings;
}
