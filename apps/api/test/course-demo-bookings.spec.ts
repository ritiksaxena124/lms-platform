import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A course's invitation to a trial call, and who may send it.
 *
 * `demoBookingsEnabled` decides whether a student who has not bought a place may ask this teacher
 * for one hour anyway. It is the course's own yes, per course rather than per teacher, because a
 * teacher who runs a serious exam-prep course and a casual conversation course does not want the
 * same trial policy on both.
 *
 * The reason it has a route of its own, and is not a field on the edit form, is that the edit form
 * closes when a course goes live: `PATCH /courses/:id` answers 409 for a published course, because
 * changing what a student is reading is an archive-then-edit decision. The trial flag has no such
 * history to protect — a teacher deciding on Tuesday to offer trials of a course that has been live
 * since March is the normal case, not the exception. So the two write through different doors, and
 * the third test below is the one that keeps them that way.
 *
 * Nothing here refuses the flag on a draft or an archived course, because there is nothing to
 * refuse: the booking gate already requires a published course, so a flag set early is one that is
 * simply waiting for its course to go live.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const TEACHER_ZONE = 'Asia/Kolkata';

const COURSE = {
  title: 'Conversation club for the shy',
  summary: 'An hour of talking about films, food and travel, with corrections as we go.',
  description:
    'We start with a question and keep talking until the hour is out. Corrections come after ' +
    'the thought, never in the middle of it, so nobody loses the thread trying not to be wrong.',
  level: 'beginner',
};

let app: INestApplication;
const prisma = new PrismaClient();

async function register(name: string, role: string): Promise<string> {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

async function userIdFor(name: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email: emailFor(name) } });
  return user.id;
}

let courseSequence = 0;

/** A course a student can see, because nothing about a trial call means anything on a draft. */
async function createPublishedCourse(token: string): Promise<{ id: string; slug: string }> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...COURSE, slug: `trials-${courseSequence}-${RUN}` })
    .expect(201);
  const id = res.body.course.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return { id, slug: res.body.course.slug as string };
}

function readCourse(id: string, token: string) {
  return request(app.getHttpServer())
    .get(`/api/v1/courses/${id}`)
    .set('Authorization', `Bearer ${token}`);
}

function setTrials(id: string, body: object, token?: string) {
  const call = request(app.getHttpServer()).post(`/api/v1/courses/${id}/demo-bookings`);
  return token ? call.set('Authorization', `Bearer ${token}`).send(body) : call.send(body);
}

function calendarFor(student: string, course: string) {
  return request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course })
    .set('Authorization', `Bearer ${student}`);
}

describe('a course’s trial-call opt-in', () => {
  let teacher: string;
  let rival: string;
  let student: string;
  let course: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('trialr', 'teacher');
    rival = await register('trialo', 'teacher');
    student = await register('trials', 'student');

    const teacherId = await userIdFor('trialr');
    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });
    await request(app.getHttpServer())
      .post('/api/v1/availability/rules')
      .set('Authorization', `Bearer ${teacher}`)
      .send({ weekday: 1, startMinutes: 540, endMinutes: 600, slotMinutes: 60 })
      .expect(201);

    course = await createPublishedCourse(teacher);
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.booking.deleteMany({
      where: { OR: [{ studentUserId: { in: userIds } }, { teacherUserId: { in: userIds } }] },
    });
    await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
    await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('is off until the teacher says otherwise', async () => {
    const read = await readCourse(course.id, teacher).expect(200);
    expect(read.body.course.demoBookingsEnabled).toBe(false);

    // And the student who has not bought a place is told so, on the calendar rather than at the
    // moment they press a button that was never going to work.
    const calendar = await calendarFor(student, course.id).expect(200);
    expect(calendar.body.entitlement).toBe('none');
    expect(calendar.body.denial).toBe('enrollment_required');
  });

  it('opens the trial calendar the moment the teacher opts in', async () => {
    const res = await setTrials(course.id, { enabled: true }, teacher).expect(200);
    expect(res.body.course.demoBookingsEnabled).toBe(true);
    expect((await readCourse(course.id, teacher).expect(200)).body.course.demoBookingsEnabled).toBe(
      true,
    );

    const calendar = await calendarFor(student, course.id).expect(200);
    expect(calendar.body.entitlement).toBe('demo');
    expect(calendar.body.denial).toBeNull();
    expect(calendar.body.slots.length).toBeGreaterThan(0);

    await setTrials(course.id, { enabled: false }, teacher).expect(200);
  });

  it('is a switch on a live course, where the edit form will not reach', async () => {
    // The same course, published and reading the same way to both doors: the form that edits what
    // a student is reading is closed, and the trial flag is not.
    await request(app.getHttpServer())
      .patch(`/api/v1/courses/${course.id}`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ title: 'Conversation club, renamed' })
      .expect(409);

    const res = await setTrials(course.id, { enabled: true }, teacher).expect(200);
    expect(res.body.course.status.code).toBe('published');
    expect(res.body.course.demoBookingsEnabled).toBe(true);
    await setTrials(course.id, { enabled: false }, teacher).expect(200);
  });

  it('closes again, and says the same thing when asked twice', async () => {
    await setTrials(course.id, { enabled: true }, teacher).expect(200);
    const once = await setTrials(course.id, { enabled: false }, teacher).expect(200);
    const twice = await setTrials(course.id, { enabled: false }, teacher).expect(200);

    expect(once.body.course.demoBookingsEnabled).toBe(false);
    expect(twice.body.course.demoBookingsEnabled).toBe(false);
    expect(twice.body.course.id).toBe(course.id);
  });

  it('is not a field the edit form carries', async () => {
    // The route exists so the flag can move on a live course; a body that could also write it
    // through the closed edit door would make that rule a matter of which screen you used.
    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/courses/${course.id}`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ demoBookingsEnabled: true })
      .expect(400);
    expect(patch.body.code).toBe('VALIDATION_FAILED');

    const create = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${teacher}`)
      .send({ ...COURSE, slug: `trials-unwanted-${RUN}`, demoBookingsEnabled: true })
      .expect(400);
    expect(create.body.code).toBe('VALIDATION_FAILED');
  });

  it('wants the word, not a suggestion', async () => {
    const missing = await setTrials(course.id, {}, teacher).expect(400);
    expect(missing.body.code).toBe('VALIDATION_FAILED');
    expect(missing.body.details.validation.enabled).toBeTruthy();

    // A form that sends `"true"` as a string gets the same answer as one that sends nothing: the
    // body is JSON, and a word that quietly became a number would switch a course's door open.
    const string = await setTrials(course.id, { enabled: 'yes' }, teacher).expect(400);
    expect(string.body.code).toBe('VALIDATION_FAILED');
    expect(string.body.details.validation.enabled).toBeTruthy();

    expect((await readCourse(course.id, teacher).expect(200)).body.course.demoBookingsEnabled).toBe(
      false,
    );
  });

  it('does not exist for another teacher’s course', async () => {
    const strangers = await setTrials(course.id, { enabled: true }, rival).expect(404);
    const invented = await setTrials(randomUUID(), { enabled: true }, rival).expect(404);

    expect(strangers.body.message).toBe(invented.body.message);
    expect((await readCourse(course.id, teacher).expect(200)).body.course.demoBookingsEnabled).toBe(
      false,
    );
  });

  it('is a teacher’s own decision', async () => {
    await setTrials(course.id, { enabled: true }, student).expect(403);
    await setTrials(course.id, { enabled: true }).expect(401);
  });
});
