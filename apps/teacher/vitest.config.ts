import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The app's own `@/*` alias comes from tsconfig.json, which Vite does not read.
    alias: { '@': path.resolve(import.meta.dirname) },
  },
  test: {
    environment: 'jsdom',
    include: ['{lib,components,app}/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    css: false,
    // The student portal carries the same two lines: `bun run test` runs every package at once,
    // and an uncapped portal suite asks for eleven workers on a twelve-core box. A `userEvent`
    // test then starves rather than fails, and the timeout it hits says nothing about the
    // component under it.
    maxWorkers: 2,
    testTimeout: 15_000,
  },
});
