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
    // Two threads is the cap this box needs while all six packages test together: uncapped, one
    // portal asks for eleven workers and every `userEvent` wait on the machine slows down, so a
    // suite that passes in three seconds alone starts failing at fifteen (§17).
    poolOptions: { threads: { maxThreads: 2 } },
    testTimeout: 15_000,
  },
});
