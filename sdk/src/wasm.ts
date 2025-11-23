/**
 * WASM Module Exports
 * Exposes the nbx-wasm module and initialization function to SDK users
 */

import initWasm, * as wasmModule from '../lib/nbx-wasm/nbx_wasm.js';

export { initWasm, wasmModule };
export * from '../lib/nbx-wasm/nbx_wasm.js';
