import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@channels': resolve(__dirname, 'src/channels'),
      '@agents': resolve(__dirname, 'src/agents'),
      '@skills': resolve(__dirname, 'src/skills'),
    },
  },
});
