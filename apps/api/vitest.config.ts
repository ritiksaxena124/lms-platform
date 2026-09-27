import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Every spec file boots its own Nest app and holds its own `PrismaClient` for assertions,
    // and a Prisma pool defaults to twice the core count — so at full parallelism on a 12-core
    // box the files ask the server for far more than the 100 connections it allows, and a
    // registration fails with a pool timeout that has nothing to do with the code under test.
    // Four forks is a third of the cores and well inside what the server holds: the suite is a
    // little slower, and wrong by a lot less often.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4 } },
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
});
