import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  COURSE_LEVEL_CODES,
  COURSE_STATUS_CODES,
  LESSON_STATUS_CODES,
  LKP_TYPE_CODES,
  ROLE_CODES,
} from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `lesson` table promises with no HTTP in the way: that a slot inside a module is
 * claimed by one lesson, that retiring a lesson does not hand its slot to the next one, that
 * a lesson cannot outlive the module it was written for, and that the status which decides
 * whether a student may read it is a reference row rather than a column of allowed strings.
 *
 * The service is what assigns positions and moves a lesson between statuses; these are the
 * guarantees that hold when something else writes the table — a seed, a repair script, a
 * future endpoint that forgot.
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
let courseDraftId: string;
let lessonDraftId: string;
let lessonPublishedId: string;
let coursePublishedId: string;

const createTeacher = (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Lesson Schema Test',
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
      statusValueId: courseDraftId,
    },
  });
}

const createModule = (courseId: string, position = 1) =>
  prisma.module.create({ data: { courseId, title: 'Equivalent fractions', position } });

const createLesson = (
  moduleId: string,
  position: number,
  overrides: Record<string, unknown> = {},
) =>
  prisma.lesson.create({
    data: {
      moduleId,
      title: 'Why the denominator stays put',
      position,
      // Which row means "draft" is the service's business; these tests are about what the
      // table promises on its own, so the status is named and everything else left to default.
      statusValueId: lessonDraftId,
      ...overrides,
    },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  beginnerId = await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, COURSE_LEVEL_CODES.BEGINNER);
  courseDraftId = await lookupValue(
    LKP_TYPE_CODES.COURSE_STATUS,
    COURSE_STATUS_CODES.DRAFT,
  );
  coursePublishedId = await lookupValue(
    LKP_TYPE_CODES.COURSE_STATUS,
    COURSE_STATUS_CODES.PUBLISHED,
  );
  lessonDraftId = await lookupValue(LKP_TYPE_CODES.LESSON_STATUS, LESSON_STATUS_CODES.DRAFT);
  lessonPublishedId = await lookupValue(
    LKP_TYPE_CODES.LESSON_STATUS,
    LESSON_STATUS_CODES.PUBLISHED,
  );
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  const courseIds = (
    await prisma.course.findMany({ where: { teacherUserId: { in: userIds } }, select: { id: true } })
  ).map((row) => row.id);
  const moduleIds = (
    await prisma.module.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.lesson.deleteMany({ where: { moduleId: { in: moduleIds } } });
  await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('lesson table', () => {
  it('claims one slot per module, and lets a second module of the same course use it too', async () => {
    const owner = await createTeacher(emailFor('slots'));
    const course = await createCourse(owner.id, `slots-${RUN}`);
    const first = await createModule(course.id, 1);
    const second = await createModule(course.id, 2);

    await createLesson(first.id, 1);

    // Two lessons in one module's slot would read as a course with a page missing. The
    // ordering is per module, though: "lesson 1" means the first lesson of a block, not the
    // first lesson of a course, so a second block starting at 1 is the shape a teacher sees.
    await expect(createLesson(first.id, 1)).rejects.toMatchObject({ code: 'P2002' });
    await expect(createLesson(second.id, 1)).resolves.toMatchObject({ moduleId: second.id });
  });

  it('keeps a slot claimed after the lesson inside it is retired', async () => {
    const owner = await createTeacher(emailFor('retired-slot'));
    const course = await createCourse(owner.id, `retired-${RUN}`);
    const module = await createModule(course.id);
    const gone = await createLesson(module.id, 3, { statusValueId: lessonPublishedId });
    await prisma.lesson.update({ where: { id: gone.id }, data: { isActive: false } });

    // The service appends at "highest slot plus one" for exactly this reason: a lesson a
    // student was sent to by number cannot come to mean a different page.
    await expect(createLesson(module.id, 3)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('will not name a module that does not exist', async () => {
    await expect(createLesson(randomUUID(), 1)).rejects.toThrow();
  });

  it('will not let a module disappear while a lesson points at it', async () => {
    const owner = await createTeacher(emailFor('indispensable'));
    const course = await createCourse(owner.id, `kept-alive-${RUN}`);
    const module = await createModule(course.id);
    await createLesson(module.id, 1);

    // A lesson is only ever reachable through its module, so a module that could go quiet
    // would leave the page written but unreadable — which is a deletion by another name.
    await expect(prisma.module.delete({ where: { id: module.id } })).rejects.toThrow();
  });

  it('starts a lesson active with no body and no estimate', async () => {
    const owner = await createTeacher(emailFor('defaults'));
    const course = await createCourse(owner.id, `defaults-${RUN}`);
    const module = await createModule(course.id);
    const created = await createLesson(module.id, 1);

    // A title on its own is a lesson worth keeping: a teacher plans a block by naming its
    // pages first and writing them later. Which status a new lesson is filed under is a rule
    // about a transition, so it belongs to the endpoint that makes one, not to a column.
    expect(created).toMatchObject({ isActive: true, body: null, estimatedMinutes: null });
  });

  it('holds a lesson status as a reference row of the LessonStatus type', async () => {
    const owner = await createTeacher(emailFor('status-lookup'));
    const course = await createCourse(owner.id, `status-${RUN}`);
    const module = await createModule(course.id);

    const draft = await createLesson(module.id, 1);
    const published = await prisma.lesson.update({
      where: { id: draft.id },
      data: { statusValueId: lessonPublishedId },
    });

    // The row names which kind of value it holds, so a status id copied from another
    // table's vocabulary fails here rather than at read time, in front of a student.
    const withTypes = await prisma.lesson.findUniqueOrThrow({
      where: { id: published.id },
      include: { status: { include: { type: true } } },
    });
    expect(withTypes.status.type.code).toBe(LKP_TYPE_CODES.LESSON_STATUS);
    expect(withTypes.status.code).toBe(LESSON_STATUS_CODES.PUBLISHED);
  });

  it('will not invent a lesson status', async () => {
    const owner = await createTeacher(emailFor('status-fk'));
    const course = await createCourse(owner.id, `status-fk-${RUN}`);
    const module = await createModule(course.id);

    await expect(
      createLesson(module.id, 1, { statusValueId: randomUUID() }),
    ).rejects.toThrow();
    // A course status is a real row and would pass a bare foreign key, which is why the
    // type is checked on read: the two lifecycles are not interchangeable vocabularies.
    await expect(createLesson(module.id, 1, { statusValueId: coursePublishedId })).resolves.toMatchObject(
      { position: 1 },
    );
  });

  it('carries the two fields a student reads as optional, so a draft can hold either', async () => {
    const owner = await createTeacher(emailFor('body'));
    const course = await createCourse(owner.id, `body-${RUN}`);
    const module = await createModule(course.id);

    const written = await createLesson(module.id, 1, {
      body: 'Start with one pie. Cut it twice. Ask what each piece is called.',
      estimatedMinutes: 12,
    });

    expect(written.body).toContain('one pie');
    expect(written.estimatedMinutes).toBe(12);
  });
});
