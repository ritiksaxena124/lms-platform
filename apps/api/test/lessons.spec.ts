import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A lesson is one page inside one module, and it is the first row in this phase with a
 * lifecycle of its own.
 *
 * Four rules carry the suite. Ownership still runs through the course — a lesson is reached
 * through a module inside a course the caller owns, and every failure answers `NOT_FOUND`.
 * Order is the API's, per module: `position` is not writable, and "lesson 2" means the second
 * page of a block, not the second page of a course. A lesson's own status is the inner gate
 * and the course's is the outer one, so a page is readable only when both say so — which is
 * why a teacher can pull a half-written page out of a live course by unpublished it instead
 * of archiving the whole course. And removing a lesson from a course a student can read is
 * still refused, because that is the one action a student cannot recover from.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();

async function tokenFor(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

function listLessons(moduleId: string, token: string): request.Test {
  return request(app.getHttpServer())
    .get(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`);
}

function postLesson(moduleId: string, body: object, token: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function patchLesson(
  moduleId: string,
  id: string,
  body: object,
  token: string,
): request.Test {
  return request(app.getHttpServer())
    .patch(`/api/v1/modules/${moduleId}/lessons/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function transition(
  moduleId: string,
  id: string,
  to: 'publish' | 'unpublish' | 'deactivate',
  token: string,
): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/${id}/${to}`)
    .set('Authorization', `Bearer ${token}`);
}

function reorder(moduleId: string, lessonIds: string[], token: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/reorder`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lessonIds });
}

let courseSequence = 0;

async function createCourse(token: string): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Fractions, slowly',
      slug: `fractions-slowly-${courseSequence}-${RUN}`,
      level: 'beginner',
    })
    .expect(201);
  return res.body.course.id as string;
}

/** A course a student can see, so its lessons are promises rather than notes. */
async function createPublishedCourse(token: string): Promise<string> {
  const courseId = await createCourse(token);
  await request(app.getHttpServer())
    .patch(`/api/v1/courses/${courseId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      summary: 'A first pass at the topic.',
      description: 'Start with one pie, end with adding any two fractions.',
    })
    .expect(200);
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return courseId;
}

async function createModule(courseId: string, token: string, title = 'Equivalent fractions') {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title })
    .expect(201);
  return res.body.module.id as string;
}

async function lessonIdsOf(moduleId: string, token: string): Promise<string[]> {
  const res = await listLessons(moduleId, token).expect(200);
  return res.body.items.map((item: { id: string }) => item.id);
}

interface WrittenLesson {
  id: string;
  position: number;
  estimatedMinutes: number | null;
  status: { code: string };
}

async function createLesson(
  moduleId: string,
  token: string,
  title: string,
  body?: string,
  estimatedMinutes?: number,
): Promise<WrittenLesson> {
  const res = await postLesson(
    moduleId,
    { title, ...(body ? { body } : {}), ...(estimatedMinutes ? { estimatedMinutes } : {}) },
    token,
  ).expect(201);
  return res.body.lesson as WrittenLesson;
}

describe('lessons', () => {
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
        .send({ email: emailFor(name), password: PASSWORD, fullName: 'Lesson Test', role });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    }
    teacher = await tokenFor('tessa');
    otherTeacher = await tokenFor('rita');
    student = await tokenFor('sam');
  });

  afterAll(async () => {
    await app?.close();
    // Children before parents, or the Restrict keys leave the rows standing.
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

  it('refuses to answer without a token', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/modules/${moduleId}/lessons`)
      .expect(401);

    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('refuses a student the lesson routes', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    const res = await postLesson(moduleId, { title: 'Why the denominator stays put' }, student);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('answers an empty module with an empty list, not a missing one', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    const res = await listLessons(moduleId, teacher).expect(200);

    expect(res.body.items).toEqual([]);
  });

  it('adds a lesson at the end of the module, filed as a draft', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    const first = await postLesson(
      moduleId,
      { title: 'Why the denominator stays put', body: 'Cut the pie twice. Nothing about the pie changed.', estimatedMinutes: 8 },
      teacher,
    ).expect(201);
    const second = await createLesson(moduleId, teacher, 'Adding halves');

    expect(first.body.lesson).toMatchObject({
      moduleId,
      title: 'Why the denominator stays put',
      position: 1,
      estimatedMinutes: 8,
      status: { code: 'draft' },
    });
    expect(first.body.lesson.body).toContain('Cut the pie twice');
    expect(second.position).toBe(2);

    const res = await listLessons(moduleId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual([
      'Why the denominator stays put',
      'Adding halves',
    ]);
  });

  it('will not let the writer choose a position or a status', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    const position = await postLesson(
      moduleId,
      { title: 'Adding halves', position: 1 },
      teacher,
    ).expect(400);
    expect(position.body.code).toBe('VALIDATION_FAILED');

    const status = await postLesson(
      moduleId,
      { title: 'Adding halves', status: 'published' },
      teacher,
    ).expect(400);
    expect(status.body.code).toBe('VALIDATION_FAILED');

    // Neither write happened at all.
    expect(await lessonIdsOf(moduleId, teacher)).toEqual([]);
  });

  it('requires a title worth reading, and an estimate that could be a lesson', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    const title = await postLesson(moduleId, { title: 'a' }, teacher).expect(400);
    expect(title.body.details.validation.title).toEqual([expect.any(String)]);

    const zero = await postLesson(moduleId, { title: 'Adding halves', estimatedMinutes: 0 }, teacher);
    expect(zero.status).toBe(400);

    const absurd = await postLesson(
      moduleId,
      { title: 'Adding halves', estimatedMinutes: 5000 },
      teacher,
    );
    expect(absurd.status).toBe(400);
  });

  it('publishes a lesson that has been written, and takes it back to a draft', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const lesson = await createLesson(moduleId, teacher, 'Adding halves', 'Two halves make one whole.');

    const published = await transition(moduleId, lesson.id, 'publish', teacher).expect(200);
    expect(published.body.lesson.status).toEqual({ code: 'published', label: 'Published' });

    const back = await transition(moduleId, lesson.id, 'unpublish', teacher).expect(200);
    expect(back.body.lesson.status).toEqual({ code: 'draft', label: 'Draft' });
  });

  it('refuses to publish a page nobody has written yet, and says which field is empty', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const lesson = await createLesson(moduleId, teacher, 'Adding halves');

    const res = await transition(moduleId, lesson.id, 'publish', teacher).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.body).toEqual([expect.any(String)]);
    // Still a draft: publishing is a transition, and a refused one does not half-happen.
    const list = await listLessons(moduleId, teacher).expect(200);
    expect(list.body.items[0]?.status.code).toBe('draft');
  });

  it('will not publish a lesson whose whitespace body is only blank lines', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const lesson = await createLesson(moduleId, teacher, 'Adding halves', '   \n  ');

    const res = await transition(moduleId, lesson.id, 'publish', teacher).expect(400);

    expect(res.body.details.validation.body).toEqual([expect.any(String)]);
  });

  it('keeps a lesson where it was while its page is being rewritten', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    await createLesson(moduleId, teacher, 'Equivalent fractions');
    const second = await createLesson(moduleId, teacher, 'Adding fractions');

    const res = await patchLesson(
      moduleId,
      second.id,
      { title: 'Adding any two fractions', body: 'Same denominator first, then any two.', estimatedMinutes: 12 },
      teacher,
    ).expect(200);

    expect(res.body.lesson).toMatchObject({
      position: 2,
      title: 'Adding any two fractions',
      estimatedMinutes: 12,
    });
    expect(res.body.lesson.body).toContain('Same denominator first');
  });

  it('clears an estimate by sending it back, rather than by leaving it out', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const lesson = await createLesson(moduleId, teacher, 'Adding halves', 'Halves first.', 8);
    expect(lesson.estimatedMinutes).toBe(8);

    // An absent field means "not changed", so a form that only renamed the page cannot quietly
    // drop the estimate the teacher had already set.
    const renamed = await patchLesson(
      moduleId,
      lesson.id,
      { title: 'Adding halves, slowly' },
      teacher,
    ).expect(200);
    expect(renamed.body.lesson.estimatedMinutes).toBe(8);

    const cleared = await patchLesson(
      moduleId,
      lesson.id,
      { estimatedMinutes: null },
      teacher,
    ).expect(200);
    expect(cleared.body.lesson.estimatedMinutes).toBeNull();
  });

  it('orders by the slot the API assigned, inside one module', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const one = await createLesson(moduleId, teacher, 'One');
    const two = await createLesson(moduleId, teacher, 'Two');
    const three = await createLesson(moduleId, teacher, 'Three');

    await reorder(moduleId, [three.id, one.id, two.id], teacher).expect(200);

    const res = await listLessons(moduleId, teacher).expect(200);
    expect(
      res.body.items.map((item: { title: string; position: number }) => [item.title, item.position]),
    ).toEqual([
      ['Three', 1],
      ['One', 2],
      ['Two', 3],
    ]);
  });

  it('refuses a reorder that does not name every lesson of the module once', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const one = await createLesson(moduleId, teacher, 'One');
    const two = await createLesson(moduleId, teacher, 'Two');

    const partial = await reorder(moduleId, [one.id], teacher).expect(400);
    expect(partial.body.code).toBe('VALIDATION_FAILED');
    expect(partial.body.details.validation.lessonIds).toBeInstanceOf(Array);

    const duplicated = await reorder(moduleId, [one.id, one.id], teacher).expect(400);
    expect(duplicated.body.details.validation.lessonIds).toBeInstanceOf(Array);

    // A lesson of another module is not one of this module's slots, even though it is the
    // same teacher's — the order being written is the other module's.
    const elsewhere = await createModule(
      await createCourse(teacher),
      teacher,
      'Quadratic equations',
    );
    const foreign = await createLesson(elsewhere, teacher, 'Foreign');
    await reorder(moduleId, [one.id, two.id, foreign.id], teacher).expect(400);

    const res = await listLessons(moduleId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual(['One', 'Two']);
    expect(await lessonIdsOf(elsewhere, teacher)).toHaveLength(1);
  });

  it('reorders inside the slots the module holds, leaving gaps for what was removed', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const one = await createLesson(moduleId, teacher, 'One');
    await createLesson(moduleId, teacher, 'Two');
    const three = await createLesson(moduleId, teacher, 'Three');
    await transition(moduleId, one.id, 'deactivate', teacher).expect(200);

    const held = await lessonIdsOf(moduleId, teacher);
    await reorder(moduleId, [...held].reverse(), teacher).expect(200);

    const res = await listLessons(moduleId, teacher).expect(200);
    expect(
      res.body.items.map((item: { title: string; position: number }) => [item.title, item.position]),
    ).toEqual([
      ['Three', 2],
      ['Two', 3],
    ]);

    const next = await createLesson(moduleId, teacher, 'Four');
    expect(next.position).toBe(4);
  });

  it('moves a lesson to another module, at the end of that module', async () => {
    const courseId = await createCourse(teacher);
    const first = await createModule(courseId, teacher, 'Equivalent fractions');
    const second = await createModule(courseId, teacher, 'Adding fractions');
    await createLesson(second, teacher, 'Halves');
    const moved = await createLesson(first, teacher, 'Quarters');

    const res = await patchLesson(first, moved.id, { moduleId: second }, teacher).expect(200);

    expect(res.body.lesson).toMatchObject({ moduleId: second, position: 2 });
    expect(await lessonIdsOf(first, teacher)).toEqual([]);
    // The number it held is *not* kept warm the way a retired lesson's is: a retired row is
    // still in the module, so the arithmetic that avoids its slot sees it, while a moved row
    // has left. That is the asymmetry the id is for — a page a student was sent to by number
    // can be re-found by link, and reusing 1 in a block the teacher just emptied is the
    // reading that does not leave a phantom gap in a syllabus nobody can see.
    const appended = await createLesson(first, teacher, 'Thirds');
    expect(appended.position).toBe(1);
  });

  it('will not move a lesson into a module that is not the caller’s', async () => {
    const mine = await createModule(await createCourse(teacher), teacher);
    const theirs = await createModule(
      await createCourse(otherTeacher),
      otherTeacher,
      'Adding fractions',
    );
    const lesson = await createLesson(mine, teacher, 'Quarters');

    const res = await patchLesson(mine, lesson.id, { moduleId: theirs }, teacher).expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
    expect(await lessonIdsOf(theirs, otherTeacher)).toEqual([]);
    expect((await listLessons(mine, teacher).expect(200)).body.items).toHaveLength(1);
  });

  it('takes a lesson out of the module without destroying the row', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const one = await createLesson(moduleId, teacher, 'One');
    await createLesson(moduleId, teacher, 'Two');

    await transition(moduleId, one.id, 'deactivate', teacher).expect(200);

    const res = await listLessons(moduleId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual(['Two']);

    const row = await prisma.lesson.findUniqueOrThrow({ where: { id: one.id } });
    expect(row.isActive).toBe(false);
  });

  it('has no opinion left about a lesson that is already gone', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const one = await createLesson(moduleId, teacher, 'One');
    await transition(moduleId, one.id, 'deactivate', teacher).expect(200);

    const res = await transition(moduleId, one.id, 'deactivate', teacher).expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('answers NOT_FOUND for another teacher’s module, and never FORBIDDEN', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    const list = await listLessons(moduleId, otherTeacher).expect(404);
    expect(list.body.code).toBe('NOT_FOUND');

    const write = await postLesson(moduleId, { title: 'Not mine' }, otherTeacher).expect(404);
    expect(write.body.code).toBe('NOT_FOUND');

    // A lesson id alone is not a key: it has to sit inside the module named in the route.
    const lesson = await createLesson(moduleId, teacher, 'One');
    const elsewhere = await createModule(await createCourse(teacher), teacher, 'Adding fractions');
    const patch = await patchLesson(
      elsewhere,
      lesson.id,
      { title: 'Stolen' },
      teacher,
    ).expect(404);
    expect(patch.body.code).toBe('NOT_FOUND');
  });

  it('will not let a malformed id reach the database', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);

    await patchLesson(moduleId, 'not-a-uuid', { title: 'Nope' }, teacher).expect(404);
    await transition(moduleId, 'not-a-uuid', 'publish', teacher).expect(404);
    await listLessons('not-a-uuid', teacher).expect(404);
  });

  it('lets a teacher write, publish and unpublish pages of a course a student can read', async () => {
    const moduleId = await createModule(await createPublishedCourse(teacher), teacher);

    const lesson = await createLesson(moduleId, teacher, 'Equivalent fractions', 'On a number line.', 10);
    const renamed = await patchLesson(
      moduleId,
      lesson.id,
      { title: 'Equivalent fractions, on a number line' },
      teacher,
    ).expect(200);
    const published = await transition(moduleId, lesson.id, 'publish', teacher).expect(200);
    const hidden = await transition(moduleId, lesson.id, 'unpublish', teacher).expect(200);

    expect(renamed.body.lesson.title).toBe('Equivalent fractions, on a number line');
    expect(published.body.lesson.status.code).toBe('published');
    expect(hidden.body.lesson.status.code).toBe('draft');
  });

  it('refuses to take away what a student may be reading, and names the way round it', async () => {
    const moduleId = await createModule(await createPublishedCourse(teacher), teacher);
    const lesson = await createLesson(moduleId, teacher, 'One', 'Written and finished.', 6);
    await transition(moduleId, lesson.id, 'publish', teacher).expect(200);

    const res = await transition(moduleId, lesson.id, 'deactivate', teacher).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toMatch(/unpublish|archive/i);

    const list = await listLessons(moduleId, teacher).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]?.status.code).toBe('published');
  });

  it('counts a retired lesson when choosing the next slot, whatever its status was', async () => {
    const moduleId = await createModule(await createCourse(teacher), teacher);
    const written = await createLesson(moduleId, teacher, 'Written', 'A page with a body.');
    await transition(moduleId, written.id, 'publish', teacher).expect(200);
    await transition(moduleId, written.id, 'deactivate', teacher).expect(200);

    const next = await createLesson(moduleId, teacher, 'Next');

    expect(next.position).toBe(2);
    expect(next.status.code).toBe('draft');
  });
});
