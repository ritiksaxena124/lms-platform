import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';

import { ScryptPasswordHasher } from '../modules/auth/password-hasher.service';
import { EMAIL_TEMPLATE_SEEDS } from './email-template-data';
import { REQUIRED_LKP_TYPES } from './reference-data';
import { seedEmailTemplates } from './seed-email-templates';
import { assertSeedTargetAllowed, seedLookups } from './seed-lookups';
import { DEMO_PASSWORD, seedDemoAccounts } from './seed-demo-accounts';

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

    // The other half of what a notification needs: an event with no row here is a letter the sweep
    // can queue and cannot write.
    await seedEmailTemplates(prisma);
    console.log(
      `Seeded email copy for ${Object.keys(EMAIL_TEMPLATE_SEEDS).length} send decision(s)`,
    );

    // Skipped rather than failed on a server, because the reference rows above are exactly
    // what production needs from this command. `seedDemoAccounts` still refuses.
    if (process.env.NODE_ENV === 'production') {
      console.log('Skipped demo accounts: NODE_ENV is production');
      return;
    }

    const created = await seedDemoAccounts(prisma, new ScryptPasswordHasher());
    console.log(
      created > 0
        ? `Seeded ${created} demo accounts (teacher@, student@, ops@), password: ${DEMO_PASSWORD}`
        : 'Demo accounts already exist; left them exactly as they are',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
