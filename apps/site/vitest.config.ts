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
    // The same cap the portals test under (§17): this package renders static markup, so it is the
    // cheapest suite in the workspace, but it still runs beside five others that are not.
    maxWorkers: 2,
    testTimeout: 15_000,
  },
});
