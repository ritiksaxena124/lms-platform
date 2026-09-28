import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A module is one ordered block inside a course, and everything about it is decided by the
 * course it sits in.
 *
 * Three rules carry the suite. Ownership is inherited: a module is reached through a course
 * the caller owns, so another teacher's syllabus answers `NOT_FOUND` the same way another
 * teacher's course does. Order is the API's to assign — `position` is not a writable field,
 * because a client that could pick one could put two modules in the same slot. And the
 * course's lifecycle bites here asymmetrically: adding and renaming a module while a course
 * is live gives a student more to read, which is safe, while removing one takes away what
 * they may be working through, which is not.
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

function listModules(courseId: string, token: string): request.Test {
  return request(app.getHttpServer())
    .get(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`);
}

function postModule(courseId: string, body: object, token: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function patchModule(courseId: string, id: string, body: object, token: string): request.Test {
  return request(app.getHttpServer())
    .patch(`/api/v1/courses/${courseId}/modules/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function reorder(courseId: string, moduleIds: string[], token: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules/reorder`)
    .set('Authorization', `Bearer ${token}`)
    .send({ moduleIds });
}

function deactivate(courseId: string, id: string, token: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules/${id}/deactivate`)
    .set('Authorization', `Bearer ${token}`);
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

/** A course a student can see: published, so its syllabus is a promise. */
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

async function moduleIdsOf(courseId: string, token: string): Promise<string[]> {
  const res = await listModules(courseId, token).expect(200);
  return res.body.items.map((item: { id: string }) => item.id);
}

describe('course modules', () => {
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
        .send({ email: emailFor(name), password: PASSWORD, fullName: 'Module Test', role });
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
    await prisma.module.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('refuses to answer without a token', async () => {
    const courseId = await createCourse(teacher);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/courses/${courseId}/modules`)
      .expect(401);

    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('refuses a student the module routes', async () => {
    const courseId = await createCourse(teacher);

    const res = await postModule(courseId, { title: 'Equivalent fractions' }, student).expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('answers an empty course with an empty list, not a missing one', async () => {
    const courseId = await createCourse(teacher);

    const res = await listModules(courseId, teacher).expect(200);

    expect(res.body.items).toEqual([]);
  });

  it('adds a module at the end of the order and reads it back', async () => {
    const courseId = await createCourse(teacher);

    const first = await postModule(courseId, { title: 'Equivalent fractions' }, teacher).expect(201);
    const second = await postModule(
      courseId,
      {
        title: 'Adding fractions',
        summary: 'Same denominator first, then any two.',
        description: 'We add halves before we touch thirds, because the picture is still obvious.',
      },
      teacher,
    ).expect(201);

    expect(first.body.module).toMatchObject({
      courseId,
      title: 'Equivalent fractions',
      position: 1,
      summary: null,
      description: null,
    });
    expect(second.body.module.position).toBe(2);

    const res = await listModules(courseId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual([
      'Equivalent fractions',
      'Adding fractions',
    ]);
  });

  it('will not let the writer choose a position', async () => {
    const courseId = await createCourse(teacher);
    await postModule(courseId, { title: 'Equivalent fractions' }, teacher).expect(201);

    const res = await postModule(
      courseId,
      { title: 'Adding fractions', position: 1 },
      teacher,
    ).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    // The rejected write did not happen at all, rather than happening without its slot.
    const items = await listModules(courseId, teacher).expect(200);
    expect(items.body.items).toHaveLength(1);
  });

  it('requires a title worth reading', async () => {
    const courseId = await createCourse(teacher);

    const res = await postModule(courseId, { title: 'a' }, teacher).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.title).toEqual([expect.any(String)]);
  });

  it('keeps a module where it was when only its title changes', async () => {
    const courseId = await createCourse(teacher);
    await postModule(courseId, { title: 'Equivalent fractions' }, teacher).expect(201);
    const second = await postModule(courseId, { title: 'Adding fractions' }, teacher).expect(201);

    const res = await patchModule(
      courseId,
      second.body.module.id,
      { title: 'Adding any two fractions' },
      teacher,
    ).expect(200);

    expect(res.body.module).toMatchObject({ position: 2, title: 'Adding any two fractions' });
  });

  it('orders by the slot the API assigned, not by what was written last', async () => {
    const courseId = await createCourse(teacher);
    const one = await postModule(courseId, { title: 'One' }, teacher).expect(201);
    const two = await postModule(courseId, { title: 'Two' }, teacher).expect(201);
    const three = await postModule(courseId, { title: 'Three' }, teacher).expect(201);

    await reorder(courseId, [three.body.module.id, one.body.module.id, two.body.module.id], teacher).expect(
      200,
    );

    const res = await listModules(courseId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string; position: number }) => [item.title, item.position])).toEqual([
      ['Three', 1],
      ['One', 2],
      ['Two', 3],
    ]);
  });

  it('reorders inside the slots the course already holds, leaving gaps for what was removed', async () => {
    const courseId = await createCourse(teacher);
    const one = await postModule(courseId, { title: 'One' }, teacher).expect(201);
    await postModule(courseId, { title: 'Two' }, teacher).expect(201);
    const three = await postModule(courseId, { title: 'Three' }, teacher).expect(201);
    await deactivate(courseId, one.body.module.id, teacher).expect(200);

    // Active modules hold slots 2 and 3; a reorder permutes those two and never reaches
    // over the retired row sitting on 1.
    await reorder(courseId, [three.body.module.id], teacher).expect(400);
    const missing = await moduleIdsOf(courseId, teacher);
    await reorder(courseId, [...missing].reverse(), teacher).expect(200);

    const res = await listModules(courseId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string; position: number }) => [item.title, item.position])).toEqual([
      ['Three', 2],
      ['Two', 3],
    ]);

    const next = await postModule(courseId, { title: 'Four' }, teacher).expect(201);
    expect(next.body.module.position).toBe(4);
  });

  it('refuses a reorder that does not name every module once', async () => {
    const courseId = await createCourse(teacher);
    const one = await postModule(courseId, { title: 'One' }, teacher).expect(201);
    const two = await postModule(courseId, { title: 'Two' }, teacher).expect(201);

    const partial = await reorder(courseId, [one.body.module.id], teacher).expect(400);
    expect(partial.body.code).toBe('VALIDATION_FAILED');
    expect(partial.body.details.validation.moduleIds).toBeInstanceOf(Array);

    const duplicated = await reorder(
      courseId,
      [one.body.module.id, one.body.module.id],
      teacher,
    ).expect(400);
    expect(duplicated.body.details.validation.moduleIds).toBeInstanceOf(Array);

    const foreign = await reorder(
      courseId,
      [one.body.module.id, two.body.module.id, randomUUID()],
      teacher,
    ).expect(400);
    expect(foreign.body.details.validation.moduleIds).toBeInstanceOf(Array);

    // Nothing moved while the list was being argued about.
    const res = await listModules(courseId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual(['One', 'Two']);
  });

  it('takes a module out of the syllabus without destroying the row', async () => {
    const courseId = await createCourse(teacher);
    const one = await postModule(courseId, { title: 'One' }, teacher).expect(201);
    await postModule(courseId, { title: 'Two' }, teacher).expect(201);

    await deactivate(courseId, one.body.module.id, teacher).expect(200);

    const res = await listModules(courseId, teacher).expect(200);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual(['Two']);

    const row = await prisma.module.findUniqueOrThrow({ where: { id: one.body.module.id } });
    expect(row.isActive).toBe(false);
  });

  it('has no opinion left about a module that is already gone', async () => {
    const courseId = await createCourse(teacher);
    const one = await postModule(courseId, { title: 'One' }, teacher).expect(201);
    await deactivate(courseId, one.body.module.id, teacher).expect(200);

    const res = await deactivate(courseId, one.body.module.id, teacher).expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('answers NOT_FOUND for another teacher’s course, and never FORBIDDEN', async () => {
    const courseId = await createCourse(teacher);
    const mine = await moduleIdsOf(courseId, teacher);
    expect(mine).toEqual([]);

    const list = await listModules(courseId, otherTeacher).expect(404);
    expect(list.body.code).toBe('NOT_FOUND');

    const write = await postModule(courseId, { title: 'Not mine' }, otherTeacher).expect(404);
    expect(write.body.code).toBe('NOT_FOUND');

    // A module id alone is not a key: it has to sit inside the course named in the route.
    const created = await postModule(courseId, { title: 'One' }, teacher).expect(201);
    const elsewhere = await createCourse(otherTeacher);
    const patch = await patchModule(
      elsewhere,
      created.body.module.id,
      { title: 'Stolen' },
      otherTeacher,
    ).expect(404);
    expect(patch.body.code).toBe('NOT_FOUND');
  });

  it('will not let a malformed id reach the database', async () => {
    const courseId = await createCourse(teacher);

    await patchModule(courseId, 'not-a-uuid', { title: 'Nope' }, teacher).expect(404);
    await deactivate(courseId, 'not-a-uuid', teacher).expect(404);
  });

  it('lets a teacher build the syllabus of a course a student can already read', async () => {
    const courseId = await createPublishedCourse(teacher);

    const added = await postModule(courseId, { title: 'Equivalent fractions' }, teacher).expect(201);
    const renamed = await patchModule(
      courseId,
      added.body.module.id,
      { title: 'Equivalent fractions, on a number line' },
      teacher,
    ).expect(200);

    expect(renamed.body.module.title).toBe('Equivalent fractions, on a number line');
  });

  it('refuses to take away a block a student may be reading', async () => {
    const courseId = await createPublishedCourse(teacher);
    const one = await postModule(courseId, { title: 'One' }, teacher).expect(201);
    const moduleId = one.body.module.id as string;

    const written = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ title: 'Why the denominator stays put', body: 'Cut the pie twice.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${written.body.lesson.id}/publish`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);

    const res = await deactivate(courseId, moduleId, teacher).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toMatch(/lesson/i);

    const list = await listModules(courseId, teacher).expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('lets a live course let go of a block with nothing readable in it', async () => {
    const courseId = await createPublishedCourse(teacher);
    const added = await postModule(courseId, { title: 'A start' }, teacher).expect(201);
    const draftOnly = await postModule(courseId, { title: 'Still being planned' }, teacher).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/modules/${draftOnly.body.module.id}/lessons`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ title: 'A page not published yet' })
      .expect(201);

    // A block is on the catalog only while it holds something to read, so taking away an
    // empty one — or one whose every page is still a draft — hides nothing from anybody.
    await deactivate(courseId, added.body.module.id, teacher).expect(200);
    await deactivate(courseId, draftOnly.body.module.id, teacher).expect(200);

    const list = await listModules(courseId, teacher).expect(200);
    expect(list.body.items).toEqual([]);
  });
});
