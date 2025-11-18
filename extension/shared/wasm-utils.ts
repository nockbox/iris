/**
 * WASM Utilities
 * Centralized utilities for loading and initializing WASM modules
 */

import initCryptoWasm from '../lib/nbx-crypto/nbx_crypto';
import initWasmTx from '../lib/nbx-wasm/nbx_wasm';

/**
 * WASM module paths relative to extension root
 */
export const WASM_PATHS = {
  CRYPTO: 'lib/nbx-crypto/nbx_crypto_bg.wasm',
  TX_BUILDER: 'lib/nbx-wasm/nbx_wasm_bg.wasm',
} as const;

/**
 * Get the full URL for a WASM module
 * @param path - Path relative to extension root
 */
export function getWasmUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

/**
 * Get URLs for commonly used WASM modules
 */
export function getWasmUrls() {
  return {
    crypto: getWasmUrl(WASM_PATHS.CRYPTO),
    txBuilder: getWasmUrl(WASM_PATHS.TX_BUILDER),
  };
}

/**
 * Initialize both crypto and transaction builder WASM modules
 * This is a common pattern used throughout the codebase
 */
export async function initWasmModules(): Promise<void> {
  const urls = getWasmUrls();
  await Promise.all([
    initCryptoWasm({ module_or_path: urls.crypto }),
    initWasmTx({ module_or_path: urls.txBuilder }),
  ]);
}

/**
 * Track if WASM modules have been initialized (per-context)
 */
let wasmInitialized = false;

/**
 * Initialize WASM modules only once per context
 * Subsequent calls will be no-ops
 */
export async function ensureWasmInitialized(): Promise<void> {
  if (wasmInitialized) {
    return;
  }
  await initWasmModules();
  wasmInitialized = true;
}

/**
 * Reset WASM initialization state (mainly for testing)
 */
export function resetWasmInitialization(): void {
  wasmInitialized = false;
}
