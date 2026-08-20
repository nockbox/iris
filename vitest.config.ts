import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['extension/**/*.test.ts', 'tests/**/*.test.mjs'],
  },
});
