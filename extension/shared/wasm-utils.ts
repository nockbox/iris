/**
 * WASM Utilities
 * Centralized utilities for loading and initializing WASM modules
 */

import initWasm from '../lib/iris-wasm/iris_wasm';

/**
 * Asset paths for WASM modules (relative to extension root)
 */
export const WASM_ASSET_PATHS = {
  IRIS_WASM: 'lib/iris-wasm/iris_wasm_bg.wasm',
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
    irisWasm: getWasmUrl(WASM_ASSET_PATHS.IRIS_WASM),
  };
}

/**
 * Track if WASM modules have been initialized (per-context)
 */
let wasmInitialized = false;
let wasmInitializing = false;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Initialize WASM modules only once per context
 * Subsequent calls will be no-ops
 */
export async function initWasmModules(): Promise<void> {
  if (wasmInitialized) {
    return;
  }

  if (wasmInitializing && wasmInitPromise) {
    return wasmInitPromise;
  }

  wasmInitializing = true;

  wasmInitPromise = (async () => {
    try {
      const wasmUrls = getWasmUrls();
      await initWasm(wasmUrls.irisWasm);
      wasmInitialized = true;
      wasmInitializing = false;
    } catch (error) {
      wasmInitializing = false;
      wasmInitPromise = null; // Reset promise on error
      throw error;
    }
  })();

  return wasmInitPromise;
}

/**
 * Initialize WASM modules only once per context
 * Alias for initWasmModules with idempotent behavior
 */
export async function ensureWasmInitialized(): Promise<void> {
  return initWasmModules();
}

/**
 * Reset WASM initialization state (mainly for testing)
 */
export function resetWasmInitialization(): void {
  wasmInitialized = false;
  wasmInitializing = false;
  wasmInitPromise = null;
}
