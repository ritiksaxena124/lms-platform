import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';

import { REQUIRED_LKP_TYPES } from './reference-data';
import { assertSeedTargetAllowed, seedLookups } from './seed-lookups';

/**
 * `bun run db:seed`. Bun loads `.env` before this file runs, so DATABASE_URL is already
 * in the environment; the guard is what stops that same command from reaching a server.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  assertSeedTargetAllowed(databaseUrl);

  const prisma = new PrismaClient();
  try {
    await seedLookups(prisma);
    console.log(`Seeded reference data: ${REQUIRED_LKP_TYPES.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
