/**
 * RPC/network config: defaults and effective config from storage.
 * Used by vault, popup (sync), background (dApp grpcEndpoint), and RpcSettingsScreen.
 */

import { STORAGE_KEYS, RPC_ENDPOINT } from './constants';

export interface RpcConfig {
  rpcUrl: string;
  networkName: string;
  blockExplorerUrl: string;
}

/** Stored config is partial; unset keys fall back to defaults */
export type StoredRpcConfig = Partial<RpcConfig>;

const DEFAULT_NETWORK_NAME = 'Nockchain Mainnet';
const DEFAULT_BLOCK_EXPLORER_URL = 'https://nockscan.net';

/** Default RPC config (used when nothing is stored, and for "Reset to default") */
export const defaultRpcConfig: RpcConfig = {
  rpcUrl: RPC_ENDPOINT,
  networkName: DEFAULT_NETWORK_NAME,
  blockExplorerUrl: DEFAULT_BLOCK_EXPLORER_URL,
};

function ensureHttps(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return RPC_ENDPOINT;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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
    return { ...defaultRpcConfig };
  }

  const merged: RpcConfig = {
    rpcUrl: stored.rpcUrl != null && stored.rpcUrl !== '' ? stored.rpcUrl : defaultRpcConfig.rpcUrl,
    networkName: stored.networkName ?? defaultRpcConfig.networkName,
    blockExplorerUrl: stored.blockExplorerUrl ?? defaultRpcConfig.blockExplorerUrl,
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
