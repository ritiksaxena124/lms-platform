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
 * which is what makes "leave an existing row alone" a safe thing for the database to decide
 * on its own — and it does decide it here, through `skipDuplicates`.
 *
 * That is the whole reason this function does not read like the rest of the codebase. It used
 * to call `upsert` per row, and an `upsert` is a read followed by a write: two processes on a
 * cold database both look for `CourseStatus`, both find nothing, both insert, and one is told
 * the row it just checked for already existed. Every spec file seeds for itself and four run at
 * once, so on a database that has never been seeded — which is every CI run and no local one —
 * that is a race whose odds of being noticed are about three files in sixty-five. It was
 * noticed: `catalog`, `enrollments` and `mail-delivery` failed their `beforeAll` on `P2002`
 * while the other six hundred and twenty-odd tests passed.
 */
export async function seedLookups(prisma: PrismaClient): Promise<void> {
  validateLookupSeeds(
    Object.fromEntries(
      Object.entries(LOOKUP_SEEDS).map(([code, seed]) => [code, seed.values.map((v) => v.code)]),
    ),
    REQUIRED_LKP_TYPES,
  );

  const types = REQUIRED_LKP_TYPES.flatMap((code) => {
    const seed = LOOKUP_SEEDS[code];
    return seed ? [{ code, description: seed.description, values: seed.values }] : [];
  });

  await prisma.lkpType.createMany({
    data: types.map(({ code, description }) => ({ code, description })),
    skipDuplicates: true,
  });

  // The ids are read back rather than taken from the insert, because a row some other process
  // created a moment ago is still a row that had better be here now.
  const idByCode = new Map(
    (
      await prisma.lkpType.findMany({
        where: { code: { in: types.map((type) => type.code) } },
        select: { id: true, code: true },
      })
    ).map((row) => [row.code, row.id]),
  );

  await prisma.lkpValue.createMany({
    data: types.flatMap(({ code, values }) => {
      const typeId = idByCode.get(code);
      if (!typeId) {
        throw new Error(
          `Reference seed lost lookup type "${code}" between the insert and the read`,
        );
      }
      return values.map((value, position) => ({
        typeId,
        code: value.code,
        label: value.label,
        position,
      }));
    }),
    skipDuplicates: true,
  });
}
