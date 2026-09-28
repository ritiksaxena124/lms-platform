import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COURSE_LEVEL_CODES, COURSE_STATUS_CODES, LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `module` table promises with no HTTP in the way: that a slot inside a course is
 * claimed by one module, that retiring a module does not hand its slot to the next one, and
 * that a module cannot outlive or out-rank the course it belongs to.
 *
 * The service is what assigns positions; these are the guarantees that hold when something
 * else writes the table — a seed, a repair script, a future endpoint that forgot.
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

const createTeacher = (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Module Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId: teacherRoleId,
      statusValueId: activeStatusId,
    },
  });

async function createCourse(teacherId: string, slug: string) {
  return prisma.course.create({
    data: {
      teacherUserId: teacherId,
      title: 'Fractions, slowly',
      slug,
      levelValueId: beginnerId,
      statusValueId: draftId,
    },
  });
}

const createModule = (courseId: string, position: number, overrides: Record<string, unknown> = {}) =>
  prisma.module.create({
    data: { courseId, title: 'Equivalent fractions', position, ...overrides },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  beginnerId = await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, COURSE_LEVEL_CODES.BEGINNER);
  draftId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.DRAFT);
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  const courseIds = (
    await prisma.course.findMany({ where: { teacherUserId: { in: userIds } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.module.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('module table', () => {
  it('claims one slot per course, and lets another course use the same slot', async () => {
    const owner = await createTeacher(emailFor('slots'));
    const first = await createCourse(owner.id, `first-${RUN}`);
    const second = await createCourse(owner.id, `second-${RUN}`);

    await createModule(first.id, 1);

    await expect(createModule(first.id, 1)).rejects.toMatchObject({ code: 'P2002' });
    await expect(createModule(second.id, 1)).resolves.toMatchObject({ courseId: second.id });
  });

  it('keeps a slot claimed after the module inside it is retired', async () => {
    const owner = await createTeacher(emailFor('retired-slot'));
    const course = await createCourse(owner.id, `retired-${RUN}`);
    const gone = await createModule(course.id, 2);
    await prisma.module.update({ where: { id: gone.id }, data: { isActive: false } });

    // Two modules in slot 2 would read as one syllabus with a page missing, and the
    // service appends at "highest slot plus one" for exactly this reason.
    await expect(createModule(course.id, 2)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('will not name a course that does not exist', async () => {
    await expect(createModule(randomUUID(), 1)).rejects.toThrow();
  });

  it('will not let a course disappear while its syllabus points at it', async () => {
    const owner = await createTeacher(emailFor('indispensable'));
    const course = await createCourse(owner.id, `kept-alive-${RUN}`);
    await createModule(course.id, 1);

    await expect(prisma.course.delete({ where: { id: course.id } })).rejects.toThrow();
  });

  it('starts a module active, with nothing filled in beyond a title', async () => {
    const owner = await createTeacher(emailFor('defaults'));
    const course = await createCourse(owner.id, `defaults-${RUN}`);
    const created = await createModule(course.id, 1);

    expect(created).toMatchObject({ isActive: true, summary: null, description: null });
  });

  it('carries no status of its own, because the course decides who can read it', async () => {
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'module'`,
    );

    // A module with its own lifecycle would need a second set of rules for what a student
    // sees: published course, unpublished module, and no honest answer to which wins.
    expect(columns.map((column) => column.column_name)).not.toContain(
      expect.stringMatching(/status|price|amount|currency/i),
    );
  });
});
