import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROLE_CODES } from '@lms/shared';

import { ScryptPasswordHasher } from '../src/modules/auth/password-hasher.service';
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  assertDemoSeedAllowed,
  seedDemoAccounts,
} from '../src/reference/seed-demo-accounts';
import { seedLookups } from '../src/reference/seed-lookups';

/**
 * Three accounts you are meant to hand to a stranger testing the POC, including the one
 * role nobody can ask for at the sign-up form. Their whole job is to be usable, so what is
 * tested here is that they exist in every environment that is not production, that the
 * documented password is the one that opens them, and that running the seeder again cannot
 * undo a password someone changed while testing.
 */
const prisma = new PrismaClient();
const hasher = new ScryptPasswordHasher();

describe('demo accounts', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    await seedDemoAccounts(prisma, hasher);
  });

  afterAll(async () => {
    const emails = DEMO_ACCOUNTS.map((account) => account.email);
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it('creates one account per role, including the one registration refuses', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: DEMO_ACCOUNTS.map((account) => account.email) } },
      include: { role: true },
    });

    expect(users.map((user) => user.role.code).sort()).toEqual(
      [...Object.values(ROLE_CODES)].sort(),
    );
  });

  it('stores a digest, never the documented password', async () => {
    const teacher = await prisma.user.findFirstOrThrow({
      where: { email: 'teacher@example.test' },
    });

    expect(teacher.passwordHash).not.toContain(DEMO_PASSWORD);
    expect(teacher.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(await hasher.verify(teacher.passwordHash, DEMO_PASSWORD)).toBe(true);
  });

  it('uses addresses that cannot receive mail, because they will be public in a README', async () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.email.endsWith('@example.test')).toBe(true);
    }
  });

  it('is idempotent and leaves a changed password alone', async () => {
    const replacement = await hasher.hash('changed while testing this account');
    await prisma.user.update({
      where: { email: 'student@example.test' },
      data: { passwordHash: replacement },
    });

    await seedDemoAccounts(prisma, hasher);
    await seedDemoAccounts(prisma, hasher);

    const student = await prisma.user.findFirstOrThrow({
      where: { email: 'student@example.test' },
    });
    expect(student.passwordHash).toBe(replacement);
    expect(
      await prisma.user.count({
        where: { email: { in: DEMO_ACCOUNTS.map((account) => account.email) } },
      }),
    ).toBe(DEMO_ACCOUNTS.length);
  });
});

describe('demo account guard', () => {
  it('refuses to mint known passwords on a production server', () => {
    expect(() => assertDemoSeedAllowed('production')).toThrow(/production/i);
  });

  it('runs in the environments that are meant to have these accounts', () => {
    expect(() => assertDemoSeedAllowed('development')).not.toThrow();
    expect(() => assertDemoSeedAllowed('test')).not.toThrow();
  });
});
