import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: './examples',
  build: {
    outDir: '../examples-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'examples/index.html'),
        txBuilder: resolve(__dirname, 'examples/tx-builder.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@nockbox/iris-sdk': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
  },
  optimizeDeps: {
    exclude: ['@nockbox/iris-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
});
