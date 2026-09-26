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
    // Every form and button test here types into a real input through `userEvent`, and a whole
    // portal's suites run at once — the default 5s is a timeout on the machine, not on the code.
    testTimeout: 15_000,
  },
});
