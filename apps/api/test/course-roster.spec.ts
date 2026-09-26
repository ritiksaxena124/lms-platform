import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A teacher's roster: who holds a place in one of their courses.
 *
 * `ix_enrollment_course_roster` was built for this question and no route answered it, so the
 * table knew how many students a course had and the API did not.
 *
 * Three things shape the answers below.
 *
 * The address is a course's, so ownership is the whole permission. Another teacher's roster and
 * a uuid nobody ever wrote are one answer, exactly as on every other `/courses/:id` route: a
 * `403` here would confirm that the course exists and that somebody is inside it.
 *
 * A roster is the students who are in the course now, and it says nothing about the ones who
 * left. Their rows stay — §2, and they are the reason the pages those students read opened —
 * but a count that included them would be a headcount of a class nobody teaches.
 *
 * And a student on a roster is a name and a day, not a record. The teacher does not need an
 * email address to know who is coming to class, so the response has no field for one, and a test
 * holds that line because a field added for convenience is a field every later version has to
 * defend.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

let app: INestApplication;
const prisma = new PrismaClient();

async function tokenFor(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

/** Students are registered with names a roster can be asserted on, because the whole point of
 * this list is that a teacher recognises the rows. */
async function register(name: string, role: string, fullName: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName, role });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
}

function roster(token: string | undefined, courseId: string, query = ''): request.Test {
  const call = request(app.getHttpServer()).get(
    `/api/v1/courses/${courseId}/roster${query ? `?${query}` : ''}`,
  );
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

let courseSequence = 0;

async function createCourse(token: string): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Algebra quietly ${MARK} ${courseSequence}`,
      slug: `algebra-quietly-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'A first pass at the topic.',
      description: 'Start with a variable, end with a sentence about it.',
    })
    .expect(201);
  return res.body.course.id as string;
}

async function createPublishedCourse(token: string): Promise<string> {
  const id = await createCourse(token);
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return id;
}

async function enroll(token: string, courseId: string): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${token}`)
    .send({ courseId })
    .expect(200);
}

async function cancelFor(token: string, courseId: string): Promise<void> {
  const id = await placeIdOf(token, courseId);
  await request(app.getHttpServer())
    .post(`/api/v1/enrollments/${id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .send()
    .expect(200);
}

async function placeIdOf(token: string, courseId: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/enrollments')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const place = res.body.items.find(
    (item: { course: { id: string } }) => item.course.id === courseId,
  );
  if (!place) throw new Error('no place to find for this student');
  return place.id as string;
}

function names(items: Array<{ student: { fullName: string } }>): string[] {
  return items.map((item) => item.student.fullName);
}

/** The parts of a failure that must match. `requestId` and `timestamp` are per request, and
 * comparing them would make this "these two are the same answer" check fail for the wrong
 * reason — two requests cannot share a instant. */
function failureShape(body: Record<string, unknown>) {
  return { statusCode: body.statusCode, code: body.code, message: body.message };
}

describe('the teacher roster of a course', () => {
  let teacher: string;
  let otherTeacher: string;
  let first: string;
  let second: string;
  let third: string;

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    await register('rosta', 'teacher', 'Rosta Teacher');
    await register('ritha', 'teacher', 'Ritha Teacher');
    await register('sima', 'student', 'Sima Student');
    await register('nab', 'student', 'Nab Student');
    await register('om', 'student', 'Om Student');
    teacher = await tokenFor('rosta');
    otherTeacher = await tokenFor('ritha');
    first = await tokenFor('sima');
    second = await tokenFor('nab');
    third = await tokenFor('om');
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    const courseIds = (
      await prisma.course.findMany({
        where: { teacherUserId: { in: userIds } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
    await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('lists the students who hold a place, newest first, for the teacher who owns the course', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);
    await enroll(second, courseId);

    const res = await roster(teacher, courseId).expect(200);

    expect(new Set(names(res.body.items))).toEqual(new Set(['Sima Student', 'Nab Student']));
    expect(res.body.total).toBe(2);
    // Newest first, with dates far enough apart to order: the two enrollments were separate
    // requests, so the later one cannot precede the earlier.
    const days = res.body.items.map((item: { enrolledAt: string }) =>
      new Date(item.enrolledAt).getTime(),
    );
    expect(days[0]).toBeGreaterThanOrEqual(days[1] as number);
  });

  it('does not list a student who left, and does not count them', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);
    await enroll(second, courseId);
    await cancelFor(second, courseId);

    const res = await roster(teacher, courseId).expect(200);

    expect(names(res.body.items)).toEqual(['Sima Student']);
    expect(res.body.total).toBe(1);
  });

  it('counts one entry for a student who left and came back, on the day they first arrived', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);
    const arrivedAt = new Date().toISOString();
    await cancelFor(first, courseId);
    await enroll(first, courseId);

    const res = await roster(teacher, courseId).expect(200);

    expect(res.body.items).toHaveLength(1);
    // The reopened row is the original one, so its day did not move. The assertion compares
    // against the same instant the first enroll happened to fall inside a second of, which is
    // why it is a same-day check rather than an exact one.
    const listed = new Date(res.body.items[0].enrolledAt as string);
    expect(listed.getUTCFullYear()).toBe(new Date(arrivedAt).getUTCFullYear());
    expect(listed.getUTCMonth()).toBe(new Date(arrivedAt).getUTCMonth());
    expect(listed.getUTCDate()).toBe(new Date(arrivedAt).getUTCDate());
  });

  it('names the student and the day, and nothing else', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);

    const res = await roster(teacher, courseId).expect(200);

    expect(Object.keys(res.body.items[0]).sort()).toEqual(['enrolledAt', 'student']);
    // An email address is the field a roster would gain by accident and never drop, so it is
    // named here rather than left to a shape that permits anything.
    expect(Object.keys(res.body.items[0].student).sort()).toEqual(['fullName', 'id']);
    expect(JSON.stringify(res.body)).not.toContain(emailFor('sima'));
  });

  it('answers another teacher course exactly like a course that was never written', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);

    const someoneElses = await roster(otherTeacher, courseId).expect(404);
    const neverWritten = await roster(otherTeacher, randomUUID()).expect(404);

    expect(someoneElses.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(failureShape(someoneElses.body)).toEqual(failureShape(neverWritten.body));
    // The refusal says nothing about who is inside, either.
    expect(JSON.stringify(someoneElses.body)).not.toContain('Sima');
  });

  it('refuses a student at the door', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);

    await roster(first, courseId).expect(403);
  });

  it('refuses a caller with no session at all', async () => {
    const courseId = await createPublishedCourse(teacher);

    await roster(undefined, courseId).expect(401);
  });

  it('pages a roster that has grown, and counts the whole class on every page', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);
    await enroll(second, courseId);
    await enroll(third, courseId);

    const pageOne = await roster(teacher, courseId, 'page=1&pageSize=2').expect(200);
    const pageTwo = await roster(teacher, courseId, 'page=2&pageSize=2').expect(200);

    expect(pageOne.body.items).toHaveLength(2);
    expect(pageTwo.body.items).toHaveLength(1);
    expect(pageOne.body.total).toBe(3);
    expect(pageTwo.body.total).toBe(3);
    expect(pageOne.body.pageSize).toBe(2);
    expect(new Set([...names(pageOne.body.items), ...names(pageTwo.body.items)])).toEqual(
      new Set(['Sima Student', 'Nab Student', 'Om Student']),
    );
  });

  it('refuses a page size a roster could never render', async () => {
    const courseId = await createPublishedCourse(teacher);

    await roster(teacher, courseId, 'pageSize=101').expect(400);
  });

  it('reads a draft course for its own teacher, and finds nobody', async () => {
    const courseId = await createCourse(teacher);

    const res = await roster(teacher, courseId).expect(200);

    // A draft cannot be joined, so an empty roster is the only correct answer — and the route
    // still answers it rather than refusing, because ownership is the permission here.
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('still says who was inside a course the teacher retired', async () => {
    const courseId = await createPublishedCourse(teacher);
    await enroll(first, courseId);
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);

    const res = await roster(teacher, courseId).expect(200);

    // The pages closed and the students left the shelf, but the class the teacher taught
    // happened, and §2 keeps the rows that prove it.
    expect(names(res.body.items)).toEqual(['Sima Student']);
  });
});
