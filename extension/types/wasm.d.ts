/**
 * Type declarations for WASM modules
 * TypeScript can't find the .d.ts files when importing .js extensions
 * with moduleResolution: "bundler", so we declare them here
 */

/// <reference path="../lib/nbx-wasm/nbx_wasm.d.ts" />
/// <reference path="../lib/nbx-crypto/nbx_crypto.d.ts" />
/// <reference path="../lib/nbx-nockchain-types/nbx_nockchain_types.d.ts" />

declare module '../lib/nbx-wasm/nbx_wasm.js' {
  export * from '../lib/nbx-wasm/nbx_wasm';
}

declare module '../lib/nbx-crypto/nbx_crypto.js' {
  export * from '../lib/nbx-crypto/nbx_crypto';
}

declare module '../lib/nbx-nockchain-types/nbx_nockchain_types.js' {
  export * from '../lib/nbx-nockchain-types/nbx_nockchain_types';
}
