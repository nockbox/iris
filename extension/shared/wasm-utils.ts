/**
 * WASM Utilities
 * Centralized utilities for loading and initializing WASM modules
 */

import initWasm from '@nockbox/iris-wasm/iris_wasm.js';

/**
 * WASM module paths relative to extension root
 */
export const WASM_PATHS = {
  NBX_WASM: 'lib/iris-wasm/iris_wasm_bg.wasm',
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
    nbxWasm: getWasmUrl(WASM_PATHS.NBX_WASM),
  };
}

/**
 * Initialize WASM modules
 * This is a common pattern used throughout the codebase
 */
export async function initWasmModules(): Promise<void> {
  const urls = getWasmUrls();
  await initWasm({ module_or_path: urls.nbxWasm });
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
