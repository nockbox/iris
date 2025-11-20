/**
 * Type declarations for WASM modules
 * TypeScript can't find the .d.ts files when importing .js extensions
 * with moduleResolution: "bundler", so we declare them here
 */

/// <reference path="../lib/nbx-wasm/nbx_wasm.d.ts" />

declare module '../lib/nbx-wasm/nbx_wasm.js' {
  export * from '../lib/nbx-wasm/nbx_wasm';
}
