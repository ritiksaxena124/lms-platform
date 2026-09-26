import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The catalog: what a student may read before they are anyone's enrolled learner.
 *
 * Three rules carry the suite, and all three are the same idea seen from a different side —
 * a student never sees work that is not finished.
 *
 * The outer gate is the course's: only a published course is here at all, so a draft and an
 * archived one both answer `NOT_FOUND`, the same answer a teacher's own routes give for a
 * course that is not theirs. The inner gate is the lesson's: a published page inside a live
 * course is still invisible until the teacher publishes it, which is the reason a lesson has
 * a status of its own. And the module sits between them with no flag to consult, so its
 * `isActive` alone decides whether the block and its pages are reachable.
 *
 * Then the promise that makes this a catalog rather than a course reader: nothing here hands
 * over a page. A card carries counts of the pages a student *could* read; the detail carries
 * the syllabus — titles, order, rough length — and never a `body`. Reading is what
 * enrollment will be for.
 *
 * No route here needs a session. That is a deliberate exception to the guard every other
 * route in this API runs behind, so the suite checks the absence as carefully as its presence.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

/** Marks every title this suite writes, because the catalog is the one list that is not
 * scoped to a caller — another file's courses are in the database at the same moment. */
const MARK = RUN;

const COMPLETE = {
  summary: 'A first pass at the topic.',
  description: 'Start with one pie, end with adding any two fractions.',
};

let app: INestApplication;
const prisma = new PrismaClient();

async function tokenFor(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

function catalogList(query = '', token?: string): request.Test {
  const call = request(app.getHttpServer()).get(`/api/v1/catalog/courses${query}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

function catalogRead(id: string, token?: string): request.Test {
  const call = request(app.getHttpServer()).get(`/api/v1/catalog/courses/${id}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

function catalogListLevels(): request.Test {
  return request(app.getHttpServer()).get('/api/v1/catalog/courses/levels');
}

let courseSequence = 0;

async function createCourse(token: string, level = 'beginner'): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Fractions slowly ${MARK} ${courseSequence}`,
      slug: `fractions-slowly-${courseSequence}-${RUN}`,
      level,
      ...COMPLETE,
    })
    .expect(201);
  return res.body.course.id as string;
}

async function publishCourse(id: string, token: string) {
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
}

/** A course a student can find, which is the common enough case to be worth a helper. */
async function createPublishedCourse(token: string, level = 'beginner'): Promise<string> {
  const id = await createCourse(token, level);
  await publishCourse(id, token);
  return id;
}

async function createModule(courseId: string, token: string, title = 'Equivalent fractions') {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title })
    .expect(201);
  return res.body.module.id as string;
}

async function createLesson(
  moduleId: string,
  token: string,
  title: string,
  body = 'Cut the pie twice. Nothing about the pie changed.',
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title, body, estimatedMinutes: 8 })
    .expect(201);
  return res.body.lesson as { id: string };
}

async function transition(
  moduleId: string,
  id: string,
  verb: 'publish' | 'deactivate',
  token: string,
) {
  await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/${id}/${verb}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
}

/** The only way the catalog sees a page. */
async function writePublishedLesson(moduleId: string, token: string, title: string) {
  const lesson = await createLesson(moduleId, token, title);
  await transition(moduleId, lesson.id, 'publish', token);
  return lesson.id;
}

async function itemsMatching(query: string): Promise<Array<Record<string, unknown>>> {
  const res = await catalogList(`?q=${query}`).expect(200);
  return res.body.items;
}

describe('catalog', () => {
  let teacher: string;
  let otherTeacher: string;
  let student: string;

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    for (const [name, role] of [
      ['tessa', 'teacher'],
      ['rita', 'teacher'],
      ['sam', 'student'],
    ] as const) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: emailFor(name), password: PASSWORD, fullName: 'Catalog Test', role });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    }
    teacher = await tokenFor('tessa');
    otherTeacher = await tokenFor('rita');
    student = await tokenFor('sam');
  });

  afterAll(async () => {
    await app?.close();
    // Children before parents: the schema restricts both relations, so the order is the
    // only thing that lets the rows leave.
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
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('answers a course list with no session at all', async () => {
    const res = await catalogList().expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toMatchObject({ page: 1, pageSize: 12 });
  });

  it('answers a single course with no session at all', async () => {
    const courseId = await createPublishedCourse(teacher);

    const res = await catalogRead(courseId).expect(200);

    expect(res.body.course).toMatchObject({
      id: courseId,
      level: { code: 'beginner', label: expect.any(String) },
      teacher: { displayName: 'Catalog Test' },
    });
  });

  it('keeps a draft course out of the catalog', async () => {
    const draft = await createCourse(teacher);

    const res = await catalogRead(draft).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');

    const listed = await itemsMatching(MARK);
    expect(listed.map((item) => item.id)).not.toContain(draft);
  });

  it('counts the blocks a student can open, not the ones a teacher started', async () => {
    const courseId = await createPublishedCourse(teacher);
    const withPages = await createModule(courseId, teacher, 'Equivalent fractions');
    await createModule(courseId, teacher, 'A block with nothing published in it yet');
    await writePublishedLesson(withPages, teacher, 'Why the denominator stays put');

    const [card] = (await itemsMatching(MARK)).filter((item) => item.id === courseId);
    expect(card).toMatchObject({ moduleCount: 1, lessonCount: 1 });

    const res = await catalogRead(courseId).expect(200);
    expect(res.body.course.modules.map((module: { title: string }) => module.title)).toEqual([
      'Equivalent fractions',
    ]);
  });

  it('offers the levels a browser can filter by', async () => {
    const res = await catalogListLevels().expect(200);

    expect(res.body.items.map((item: { code: string }) => item.code)).toContain('beginner');
    expect(res.body.items[0]).toEqual({ code: expect.any(String), label: expect.any(String) });
  });

  it('shows a published course and hides the draft beside it', async () => {
    const published = await createPublishedCourse(otherTeacher);
    const draft = await createCourse(otherTeacher);

    const ids = (await itemsMatching(MARK)).map((item) => item.id);

    expect(ids).toContain(published);
    expect(ids).not.toContain(draft);
  });

  it('keeps an archived course out of the catalog', async () => {
    const courseId = await createPublishedCourse(teacher);
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);

    await catalogRead(courseId).expect(404);
    expect((await itemsMatching(MARK)).map((item) => item.id)).not.toContain(courseId);
  });

  it('counts only the pages a student may read', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    await writePublishedLesson(moduleId, teacher, 'Why the denominator stays put');
    await writePublishedLesson(moduleId, teacher, 'Adding halves');
    await createLesson(moduleId, teacher, 'A page still being written');

    const [card] = (await itemsMatching(MARK)).filter((item) => item.id === courseId);

    expect(card).toMatchObject({ moduleCount: 1, lessonCount: 2 });
  });

  it('leaves a published page of a draft course invisible', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await writePublishedLesson(moduleId, teacher, 'Adding halves');

    expect((await itemsMatching(MARK)).map((item) => item.id)).not.toContain(courseId);
    await catalogRead(courseId).expect(404);
    // Belt to the same braces: the page exists and is published, and none of that is
    // reachable through a route that has not passed the course's own gate.
    const stillThere = await request(app.getHttpServer())
      .get(`/api/v1/modules/${moduleId}/lessons`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    expect(stillThere.body.items.map((item: { id: string }) => item.id)).toContain(lessonId);
  });

  it('hides a retired lesson and a retired module', async () => {
    const courseId = await createCourse(teacher);
    const kept = await createModule(courseId, teacher, 'Fractions on a number line');
    const retiredModule = await createModule(courseId, teacher, 'A block the teacher took back');
    await writePublishedLesson(kept, teacher, 'Where a half sits');
    const retiredLesson = await writePublishedLesson(kept, teacher, 'A page taken back to the shelf');
    await createLesson(retiredModule, teacher, 'Everything in a block that is gone');
    await transition(kept, retiredLesson, 'deactivate', teacher);
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/modules/${retiredModule}/deactivate`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    await publishCourse(courseId, teacher);

    const res = await catalogRead(courseId).expect(200);

    expect(res.body.course.modules.map((module: { title: string }) => module.title)).toEqual([
      'Fractions on a number line',
    ]);
    expect(
      res.body.course.modules[0].lessons.map((lesson: { title: string }) => lesson.title),
    ).toEqual(['Where a half sits']);
  });

  it('lists the syllabus in the teacher order and names no page body', async () => {
    const courseId = await createPublishedCourse(teacher);
    const first = await createModule(courseId, teacher, 'Equivalent fractions');
    const second = await createModule(courseId, teacher, 'Adding and subtracting');
    await writePublishedLesson(second, teacher, 'Same denominator first');
    await writePublishedLesson(first, teacher, 'Why the denominator stays put');
    await writePublishedLesson(first, teacher, 'Adding halves');

    const res = await catalogRead(courseId).expect(200);

    expect(
      res.body.course.modules.map(
        (module: { title: string; lessons: Array<{ position: number; title: string }> }) => ({
          title: module.title,
          lessons: module.lessons.map((lesson) => [lesson.position, lesson.title]),
        }),
      ),
    ).toEqual([
      {
        title: 'Equivalent fractions',
        lessons: [
          [1, 'Why the denominator stays put'],
          [2, 'Adding halves'],
        ],
      },
      { title: 'Adding and subtracting', lessons: [[1, 'Same denominator first']] },
    ]);
    // The contract in words: a student sees that a page exists and how long it costs, and
    // sees none of it.
    expect(res.body.course.modules[0].lessons[0]).toEqual({
      id: expect.any(String),
      title: 'Why the denominator stays put',
      position: 1,
      estimatedMinutes: 8,
    });
    expect(JSON.stringify(res.body)).not.toContain('Cut the pie twice');
  });

  it('filters by level and reports one the catalogue does not carry', async () => {
    const advanced = await createPublishedCourse(teacher, 'advanced');

    const res = await catalogList(`?q=${MARK}&level=advanced`).expect(200);
    expect(res.body.items.map((item: { id: string }) => item.id)).toContain(advanced);
    expect(
      res.body.items.every(
        (item: { level: { code: string } }) => item.level.code === 'advanced',
      ),
    ).toBe(true);

    const unknown = await catalogList('?level=whatever').expect(400);
    expect(unknown.body.code).toBe('VALIDATION_FAILED');
    expect(unknown.body.details.validation.level).toEqual([`Not a level we know: whatever`]);
  });

  it('searches titles without regard to case', async () => {
    await createPublishedCourse(otherTeacher);

    const res = await catalogList(`?q=FRACTIONS%20SLOWLY%20${MARK}`).expect(200);

    expect(res.body.total).toBeGreaterThan(0);
    expect(
      res.body.items.every((item: { title: string }) => /fractions slowly/i.test(item.title)),
    ).toBe(true);
  });

  it('pages the catalog and says how much is left', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createPublishedCourse(teacher);
    }

    const first = await catalogList(`?q=${MARK}&pageSize=2`).expect(200);
    const second = await catalogList(`?q=${MARK}&pageSize=2&page=2`).expect(200);

    expect(first.body.items).toHaveLength(2);
    expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: expect.any(Number) });
    expect(second.body.items).toHaveLength(Math.min(2, Math.max(first.body.total - 2, 0)));
    const seen = [
      ...first.body.items.map((item: { id: string }) => item.id),
      ...second.body.items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('refuses a page beyond the last and a negative one', async () => {
    await createPublishedCourse(teacher, 'intermediate');

    await catalogList(`?q=${MARK}&page=0`).expect(400);
    const beyond = await catalogList(`?q=${MARK}&page=9999`).expect(200);
    expect(beyond.body.items).toEqual([]);
    expect(beyond.body.total).toBeGreaterThanOrEqual(1);
  });

  it('answers a malformed id the way it answers one that is not there', async () => {
    const res = await catalogRead('not-a-uuid').expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('We cannot find that course.');
  });

  it('gives a student the same read as an anonymous browser', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    await writePublishedLesson(moduleId, teacher, 'Adding halves');

    const anonymous = await catalogRead(courseId).expect(200);
    const byStudent = await catalogRead(courseId, student).expect(200);
    const byTeacher = await catalogRead(courseId, otherTeacher).expect(200);

    expect(byStudent.body).toEqual(anonymous.body);
    expect(byTeacher.body).toEqual(anonymous.body);
  });
});
