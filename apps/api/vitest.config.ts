import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
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
        // The email primitives are `.tsx` components server-rendered in this process (Phase 6b), and
        // specs here sit next to their sources, so both patterns have to parse. `tsx` costs one
        // thing: a type assertion written as `<Foo>value` is no longer readable as TypeScript,
        // because it is a JSX element. Nothing in this package is written that way, and `as` is the
        // form the rest of the codebase already uses.
        parser: { syntax: 'typescript', tsx: true, decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
});
