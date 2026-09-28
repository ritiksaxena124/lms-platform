import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
    // The last jsdom suite on the box without these two numbers, and it was not idle when the
    // gate ran: while five packages tested at once this one lost `PasswordField` and `Calendar` to
    // 5-second timeouts and passed both alone. Same cap as the portals, same reason — the
    // component is not what a starvation timeout measures.
    poolOptions: { threads: { maxThreads: 2 } },
    testTimeout: 15_000,
  },
});
