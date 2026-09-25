import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * The rules these tests hold are the ones a migration cannot express in Prisma's type
 * system: an email stays claimed after the account is deactivated, and a session row
 * cannot be removed from under a user. Both are the kind of thing that only shows up as
 * corrupted data months later.
 *
 * Rows are tagged with a per-run id rather than reusing fixed addresses, because the
 * point of the second run is to prove the first run's rows still hold the email.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const runWhere = { email: { contains: `.${RUN}@` } };

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  const value = await prisma.lkpValue.findFirstOrThrow({
    where: { type: { code: typeCode }, code },
  });
  return value.id;
}

let teacherRoleId: string;
let activeStatusId: string;

const createUser = (email: string, overrides: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Test Person',
      timezone: 'Asia/Kolkata',
      roleValueId: teacherRoleId,
      statusValueId: activeStatusId,
      ...overrides,
    },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
});

afterAll(async () => {
  // Fixture teardown, not domain behaviour: the suite has no reason to accumulate users.
  await prisma.refreshToken.deleteMany({ where: { user: runWhere } });
  await prisma.user.deleteMany({ where: runWhere });
  await prisma.$disconnect();
});

describe('users', () => {
  it('stores a user against lookup rows rather than a hard-coded role string', async () => {
    const user = await createUser(emailFor('basic'));

    expect(user.id).toBeTruthy();
    expect(user.isActive).toBe(true);
    expect(user.deletedAt).toBeNull();
  });

  it('keeps an email claimed while the account is active', async () => {
    await createUser(emailFor('claimed'));

    await expect(createUser(emailFor('claimed'))).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps an email claimed after the account is deactivated', async () => {
    const retired = await createUser(emailFor('retired'));
    await prisma.user.update({ where: { id: retired.id }, data: { isActive: false } });

    // Soft-deleting must not recycle an identity: a new account at the same address would
    // inherit the old one's bookings, payouts and reviews.
    await expect(createUser(emailFor('retired'))).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a role that is not a lookup value', async () => {
    await expect(
      createUser(emailFor('bad-role'), {
        roleValueId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow();
  });
});

describe('refresh tokens', () => {
  let userId: string;

  beforeAll(async () => {
    const studentRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.STUDENT);
    const user = await createUser(emailFor('session-owner'), { roleValueId: studentRoleId });
    userId = user.id;
  });

  it('records a session against the user it belongs to', async () => {
    const token = await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(token.revokedAt).toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(1);
  });

  it('will not let a user disappear while a session still references them', async () => {
    // onDelete: Restrict is the only thing standing between a stray delete and a session
    // that authenticates as nobody.
    await expect(prisma.user.delete({ where: { id: userId } })).rejects.toThrow();
  });
});
