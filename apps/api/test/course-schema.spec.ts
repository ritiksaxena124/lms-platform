import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  COURSE_LEVEL_CODES,
  COURSE_STATUS_CODES,
  CURRENCY_CODES,
  LKP_TYPE_CODES,
  ROLE_CODES,
} from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `course` table promises on its own, with no HTTP in the way: whose slug it is,
 * and whether a row can vanish from underneath a course that referenced it. The endpoints
 * are tested in `course.spec.ts`; these are the rules an endpoint cannot enforce later.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let activeStatusId: string;
let beginnerId: string;
let draftId: string;
let rupeeId: string;

const createTeacher = (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Course Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId: teacherRoleId,
      statusValueId: activeStatusId,
    },
  });

async function createCourse(
  teacherId: string,
  slug: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.course.create({
    data: {
      teacherUserId: teacherId,
      title: 'Algebra for the CBSE boards',
      slug,
      levelValueId: beginnerId,
      statusValueId: draftId,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  beginnerId = await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, COURSE_LEVEL_CODES.BEGINNER);
  draftId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.DRAFT);
  rupeeId = await lookupValue(LKP_TYPE_CODES.CURRENCY, CURRENCY_CODES.INR);
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({
      where: { email: { contains: `.${RUN}@` } },
      select: { id: true },
    })
  ).map((row) => row.id);
  // Fixture teardown, in the order the Restrict keys allow.
  await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('course', () => {
  it('ties a slug to one teacher and lets another use the same one', async () => {
    const first = await createTeacher(emailFor('owner-a'));
    const second = await createTeacher(emailFor('owner-b'));

    await createCourse(first.id, 'intro-to-algebra');

    await expect(createCourse(first.id, 'intro-to-algebra')).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(createCourse(second.id, 'intro-to-algebra')).resolves.toMatchObject({
      teacherUserId: second.id,
    });
  });

  it('keeps a slug claimed after the course is deactivated', async () => {
    const owner = await createTeacher(emailFor('retired'));
    const archived = await createCourse(owner.id, 'board-batch-2025');
    await prisma.course.update({ where: { id: archived.id }, data: { isActive: false } });

    // A retired course still owns its address: a second course at the same slug would
    // quietly take over every link, screenshot and message that named the first one.
    await expect(createCourse(owner.id, 'board-batch-2025')).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('will not let a teacher disappear while their course exists', async () => {
    const owner = await createTeacher(emailFor('indispensable'));
    await createCourse(owner.id, 'kept-alive');

    await expect(prisma.user.delete({ where: { id: owner.id } })).rejects.toThrow();
  });

  it('refuses a level or a status that is not a reference row', async () => {
    const owner = await createTeacher(emailFor('vocabulary'));
    const nowhere = '00000000-0000-0000-0000-000000000000';

    await expect(createCourse(owner.id, 'bad-level', { levelValueId: nowhere })).rejects.toThrow();
    await expect(
      createCourse(owner.id, 'bad-status', { statusValueId: nowhere }),
    ).rejects.toThrow();
  });

  it('starts a course active, undeleted and draft by default of the writer', async () => {
    const owner = await createTeacher(emailFor('defaults'));
    const course = await createCourse(owner.id, 'just-created');

    expect(course.isActive).toBe(true);
    expect(course.deletedAt).toBeNull();
    expect(course.summary).toBeNull();
  });

  /**
   * A price is stored the way `packages/shared` moves money everywhere else: integer minor
   * units plus a currency. This is a quote, not a charge — nothing takes payment (§6 keeps
   * that for the payments phase), and an enrollment stays a place rather than a purchase.
   * What a course costs is worth putting on the shelf before anybody can be billed for it,
   * because the number a student reads and the number a teacher writes must be one field.
   */
  it('prices a course in integer minor units and a currency row', async () => {
    const owner = await createTeacher(emailFor('priced'));
    const priced = await createCourse(owner.id, 'priced-by-the-term', {
      priceMinorUnits: 499900,
      priceCurrencyValueId: rupeeId,
    });

    // Minor units, never a float: ₹4,999.00 is 499900 paise, and a decimal column would
    // make the sum of two prices a matter of rounding. The currency is a reference row for
    // the reason level is one — which money Ops accepts is a business decision.
    expect(priced.priceMinorUnits).toBe(499900);
    expect(priced.priceCurrencyValueId).toBe(rupeeId);
  });

  it('leaves a course unpriced when neither half of a price is written', async () => {
    const owner = await createTeacher(emailFor('unpriced'));
    const course = await createCourse(owner.id, 'written-in-quiet');

    // Both null is one state, not two: a course with no price is a thing a teacher has not
    // decided about yet, and the shelf has to be able to tell that from ₹0.
    expect(course.priceMinorUnits).toBeNull();
    expect(course.priceCurrencyValueId).toBeNull();
  });

  it('reads a price of zero as a decision rather than as an absent one', async () => {
    const owner = await createTeacher(emailFor('free-course'));
    const free = await createCourse(owner.id, 'open-to-all', {
      priceMinorUnits: 0,
      priceCurrencyValueId: rupeeId,
    });

    // `0` means the teacher priced the course and named nothing. A portal that tested the
    // number for truthiness would show it as an unpriced draft.
    expect(free.priceMinorUnits).toBe(0);
    expect(free.priceCurrencyValueId).toBe(rupeeId);
  });

  it('will not let a currency row disappear while a course is priced in it', async () => {
    const owner = await createTeacher(emailFor('currency-outlived'));
    await createCourse(owner.id, 'priced-in-rupees', {
      priceMinorUnits: 100,
      priceCurrencyValueId: rupeeId,
    });

    // §2 again: the row can be retired, and a quote written against it stays readable.
    await expect(prisma.lkpValue.delete({ where: { id: rupeeId } })).rejects.toThrow();
  });

  it('refuses a price written against a row that is not there', async () => {
    const owner = await createTeacher(emailFor('bad-currency'));

    await expect(
      createCourse(owner.id, 'priced-nowhere', {
        priceMinorUnits: 500,
        priceCurrencyValueId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow();
  });
});
