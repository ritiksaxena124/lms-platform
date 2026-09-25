import type { PrismaClient } from '@prisma/client';
import { validateLookupSeeds } from '@lms/shared';

import { LOOKUP_SEEDS, REQUIRED_LKP_TYPES } from './reference-data';

/** Databases this script may write to. Anything else is a mistake or a production box. */
const SEEDABLE_DATABASES = new Set(['lms', 'lms_dev', 'lms_test']);

/**
 * Reads the database name out of a connection string. Deliberately strict: a URL whose
 * path cannot be parsed is refused rather than guessed at, because the failure mode of a
 * wrong guess is seeding — or worse, refusing to seed — the wrong server.
 */
export function assertSeedTargetAllowed(databaseUrl: string): void {
  let database: string | undefined;
  try {
    const url = new URL(databaseUrl);
    database = url.pathname.split('/').filter(Boolean).pop();
  } catch {
    database = undefined;
  }

  if (!database) {
    throw new Error('Could not read a database name from DATABASE_URL; refusing to seed');
  }
  if (!SEEDABLE_DATABASES.has(database)) {
    throw new Error(
      `Refusing to seed database "${database}"; only ${[...SEEDABLE_DATABASES].join(', ')} are allowed`,
    );
  }
}

/**
 * Creates the reference rows the application reads.
 *
 * Insert-only on purpose: an existing row keeps its `isActive`, so re-running this after
 * Ops retires a value does not silently bring it back. The unique keys are identity keys,
 * which is why a plain upsert is safe here and would not be for a business key.
 */
export async function seedLookups(prisma: PrismaClient): Promise<void> {
  validateLookupSeeds(
    Object.fromEntries(
      Object.entries(LOOKUP_SEEDS).map(([code, seed]) => [code, seed.values.map((v) => v.code)]),
    ),
    REQUIRED_LKP_TYPES,
  );

  for (const typeCode of REQUIRED_LKP_TYPES) {
    const seed = LOOKUP_SEEDS[typeCode];
    if (!seed) continue;

    const type = await prisma.lkpType.upsert({
      where: { code: typeCode },
      create: { code: typeCode, description: seed.description },
      update: {},
    });

    await Promise.all(
      seed.values.map((value, position) =>
        prisma.lkpValue.upsert({
          where: { typeId_code: { typeId: type.id, code: value.code } },
          create: { typeId: type.id, code: value.code, label: value.label, position },
          update: {},
        }),
      ),
    );
  }
}
