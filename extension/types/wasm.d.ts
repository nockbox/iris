/**
 * Type declarations for WASM modules
 * TypeScript can't find the .d.ts files when importing .js extensions
 * with moduleResolution: "bundler", so we declare them here
 */

/// <reference path="../lib/iris-wasm/iris_wasm.d.ts" />

declare module '../lib/iris-wasm/iris_wasm.js' {
  export * from '../lib/iris-wasm/iris_wasm';
}
