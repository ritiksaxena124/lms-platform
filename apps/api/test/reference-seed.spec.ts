import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { LOOKUP_SEEDS, REQUIRED_LKP_TYPES } from '../src/reference/reference-data';
import { assertSeedTargetAllowed, seedLookups } from '../src/reference/seed-lookups';

/**
 * Reference rows are the vocabulary the rest of the API talks in: a role or a status that
 * is not seeded cannot be stored, and one seeded twice cannot be trusted. Seeding is the
 * first thing every later test depends on, so it is tested before any of them exist.
 */
describe('reference data seeding', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await seedLookups(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates every reference type the application reads', async () => {
    const types = await prisma.lkpType.findMany({
      where: { code: { in: [...REQUIRED_LKP_TYPES] } },
      include: { values: true },
    });

    expect(types.map((type) => type.code).sort()).toEqual([...REQUIRED_LKP_TYPES].sort());
    for (const type of types) {
      expect(type.values.length).toBeGreaterThan(0);
    }
  });

  it('seeds the role codes the API authorises against', async () => {
    const values = await prisma.lkpValue.findMany({
      where: { type: { code: LKP_TYPE_CODES.USER_ROLE } },
    });

    expect(values.map((value) => value.code).sort()).toEqual(Object.values(ROLE_CODES).sort());
  });

  it('gives every value a label a human can read, not just a code', async () => {
    for (const [typeCode, seed] of Object.entries(LOOKUP_SEEDS)) {
      const values = await prisma.lkpValue.findMany({
        where: { type: { code: typeCode } },
        orderBy: { position: 'asc' },
      });

      expect(values.map((value) => [value.code, value.label])).toEqual(
        seed.values.map((value) => [value.code, value.label]),
      );
    }
  });

  it('is idempotent, because every boot and every test run calls it again', async () => {
    const before = await prisma.lkpValue.count();

    await seedLookups(prisma);
    await seedLookups(prisma);

    expect(await prisma.lkpValue.count()).toBe(before);
  });
});

describe('seed target guard', () => {
  it('refuses a database that is not a local or test one', () => {
    expect(() => assertSeedTargetAllowed('postgresql://u:p@db:5432/lms_prod')).toThrow(
      /refusing to seed/i,
    );
  });

  it('accepts the development and test databases', () => {
    expect(() => assertSeedTargetAllowed('postgresql://u:p@db:5432/lms')).not.toThrow();
    expect(() => assertSeedTargetAllowed('postgresql://u:p@db:5432/lms_test')).not.toThrow();
  });

  it('rejects a URL it cannot read a database name from', () => {
    expect(() => assertSeedTargetAllowed('not-a-url')).toThrow(/could not read/i);
  });
});
