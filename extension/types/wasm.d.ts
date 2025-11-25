/**
 * Type declarations for WASM modules
 * TypeScript can't find the .d.ts files when importing .js extensions
 * with moduleResolution: "bundler", so we declare them here
 */

/// <reference path="@nockbox/iris-wasm/iris_wasm.d.ts" />

declare module '@nockbox/iris-wasm/iris_wasm.js' {
  export * from '@nockbox/iris-wasm/iris_wasm';
  import init from '@nockbox/iris-wasm/iris_wasm';
  export default init;
}
