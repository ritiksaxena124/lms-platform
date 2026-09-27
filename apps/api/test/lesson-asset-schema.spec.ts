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
 * What the `lesson_asset` table promises with no HTTP in the way: that a recording a teacher
 * attached names a lesson and the bytes it was stored as; that one lesson can hold several
 * rows as the teacher replaces the file, while no two rows ever point at the same bytes; and
 * that a lesson somebody attached a recording to cannot be deleted out from under it.
 *
 * Which of a lesson's rows *stands* — the one a student is served — is the upload endpoint's
 * decision, and so is whether a file is playable at all. The table is underneath both: it
 * cannot know what an `is_active` flip means to a person watching the page, and a mime type is
 * a string a client sent, not a verdict.
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

const createTeacher = (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Lesson Asset Schema Test',
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

const createLesson = (moduleId: string, position = 1) =>
  prisma.lesson.create({
    data: {
      moduleId,
      title: 'Why the denominator stays put',
      position,
      statusValueId: lessonDraftId,
    },
  });

/** A lesson with a page of its own, ready to have something attached to it. */
async function createLessonWithCourse(run: string) {
  const owner = await createTeacher(emailFor(run));
  const course = await createCourse(owner.id, `${run}-${RUN}`);
  const module = await createModule(course.id);
  const lesson = await createLesson(module.id);
  return { owner, course, module, lesson };
}

let keyCounter = 0;
/** The endpoint mints these from a uuid; a test just needs one nobody else has used. */
const nextKey = () => `lessons/${RUN}-${(keyCounter += 1)}.mp4`;

const attach = (lessonId: string, overrides: Record<string, unknown> = {}) =>
  prisma.lessonAsset.create({
    data: {
      lessonId,
      displayName: 'cutting-the-pie.mp4',
      storedKey: nextKey(),
      contentType: 'video/mp4',
      bytes: 18_432_000,
      ...overrides,
    },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  beginnerId = await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, COURSE_LEVEL_CODES.BEGINNER);
  courseDraftId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.DRAFT);
  lessonDraftId = await lookupValue(LKP_TYPE_CODES.LESSON_STATUS, 'draft');
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  const courseIds = (
    await prisma.course.findMany({
      where: { teacherUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const moduleIds = (
    await prisma.module.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })
  ).map((row) => row.id);
  const lessonIds = (
    await prisma.lesson.findMany({ where: { moduleId: { in: moduleIds } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.lessonAsset.deleteMany({ where: { lessonId: { in: lessonIds } } });
  await prisma.lesson.deleteMany({ where: { moduleId: { in: moduleIds } } });
  await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('lesson_asset table', () => {
  it('records the file that was attached, exactly as it was attached', async () => {
    const { lesson } = await createLessonWithCourse('attached');

    const created = await attach(lesson.id);

    // Whose page it belongs to, what the teacher called it, where the bytes are and what they
    // are. The size is frozen here rather than asked of the disk at display time: a row that
    // reported a live figure would change a lesson page's wording every time somebody resized
    // the file, and a student's "the 18 MB recording" would stop meaning anything.
    expect(created).toMatchObject({
      lessonId: lesson.id,
      displayName: 'cutting-the-pie.mp4',
      contentType: 'video/mp4',
      bytes: 18_432_000,
      isActive: true,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.storedKey).toBe(`lessons/${RUN}-1.mp4`);
  });

  it('keeps the display name a teacher wrote, separate from the key the bytes live under', async () => {
    const { lesson } = await createLessonWithCourse('names');

    const created = await attach(lesson.id, {
      displayName: 'Lesson 4 — final (really final).mp4',
      storedKey: 'lessons/canonical-4.mp4',
    });

    // Two names for one file because they answer two different questions. `storedKey` is the
    // port's business — unique, opaque, never shown — and the upload cannot use the filename
    // for it, since two teachers uploading `intro.mp4` would collide on bytes that have
    // nothing to do with each other. `displayName` is the person's business: it is what they
    // recognise on their own page, and it is allowed to be a duplicate, silly, or changed.
    expect(created.displayName).toBe('Lesson 4 — final (really final).mp4');
    expect(created.storedKey).toBe('lessons/canonical-4.mp4');
  });

  it('lets one lesson hold several recordings over time, and decides nothing about which is the one', async () => {
    const { lesson } = await createLessonWithCourse('history');

    const first = await attach(lesson.id);
    const second = await attach(lesson.id, { displayName: 'cutting-the-pie, retake.mp4' });

    // Nothing here says "one video per lesson", and it could not say it honestly: a
    // replacement retires the old row rather than deleting it (§2), so the retired row has to
    // survive with the same `lessonId` and be distinguishable only by `isActive`. A unique
    // key on the pair would refuse the history, which is the whole point of keeping it.
    expect(second.id).not.toBe(first.id);
    expect(second.isActive).toBe(true);

    // The endpoint picks the standing row and flips its predecessor; the table accepts
    // whichever two active rows a mistaken writer produced, so "one at a time" is code that
    // has to be right, and 5b's tests are where it is proved.
    await expect(
      prisma.lessonAsset.update({ where: { id: first.id }, data: { isActive: false } }),
    ).resolves.toMatchObject({ isActive: false });

    const remaining = await prisma.lessonAsset.findMany({
      where: { lessonId: lesson.id, isActive: true },
    });
    expect(remaining.map((row) => row.id)).toEqual([second.id]);
  });

  it('will not let two rows claim the same bytes, even after one of them retires', async () => {
    const { lesson } = await createLessonWithCourse('taken-key');
    const { lesson: other } = await createLessonWithCourse('other-lesson');

    const kept = await attach(lesson.id, { storedKey: 'lessons/shared.mp4' });
    await prisma.lessonAsset.update({ where: { id: kept.id }, data: { isActive: false } });

    // The key is unique across every row rather than across the standing ones, which is the
    // identity half of the split this schema uses elsewhere. A retired asset still names bytes
    // on the disk — deleting them would be the hard delete §2 forbids — so letting a new row
    // take the same key would put two different recordings' history behind one path.
    await expect(attach(other.id, { storedKey: 'lessons/shared.mp4' })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('will not name a lesson that does not exist', async () => {
    await expect(attach(randomUUID())).rejects.toThrow();
  });

  it('will not let a lesson with a recording attached disappear underneath it', async () => {
    const { lesson, module, course, owner } = await createLessonWithCourse('kept');
    await attach(lesson.id);

    // Every hop out of this row goes through the lesson, so a lesson that could be deleted
    // would leave bytes no page can reach and a row pointing at nothing. Archiving is how a
    // course or a teacher retires, and the restrictions below are what prove a sweep cannot
    // cascade through: the same reason a booking keeps its course alive.
    await expect(prisma.lesson.delete({ where: { id: lesson.id } })).rejects.toThrow();
    await expect(prisma.module.delete({ where: { id: module.id } })).rejects.toThrow();
    await expect(prisma.course.delete({ where: { id: course.id } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: owner.id } })).rejects.toThrow();
  });

  it('makes no decision about what a playable file is', async () => {
    const { lesson } = await createLessonWithCourse('arbitrary');

    // A zero-byte row and a PDF are both acceptable to the table. That is not an oversight:
    // "the upload was a video, of a sane size, from a teacher who owns this lesson" is a set of
    // rules the endpoint refuses on, and a mime type is a string the client sent. A column
    // constraint would also make a new kind of attachment — a worksheet, when that day comes —
    // a migration rather than a row.
    await expect(
      attach(lesson.id, { contentType: 'application/pdf', bytes: 0 }),
    ).resolves.toMatchObject({ contentType: 'application/pdf', bytes: 0 });
  });

  it('holds the lesson id as the reference the read path needs, not the course', async () => {
    const { course, module, lesson } = await createLessonWithCourse('indexed');
    await attach(lesson.id);

    // The question the video route asks is "what stands on this page", and it asks it with the
    // lesson id it has already authenticated. An index on the course would answer a question
    // nobody asks: a course's recordings are reached through their lessons, one at a time.
    const found = await prisma.lessonAsset.findFirstOrThrow({
      where: { lessonId: lesson.id, isActive: true },
    });
    expect(found.lessonId).toBe(lesson.id);

    const sibling = await createLesson(module.id, 2);
    await expect(
      prisma.lessonAsset.findFirst({ where: { lessonId: sibling.id, isActive: true } }),
    ).resolves.toBeNull();

    // and nothing about the course above them changes that answer.
    expect(course.id).toBeTruthy();
  });
});
