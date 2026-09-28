import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type MailOutbox } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_EVENT_CODES } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The two things this platform can decide about a place in a course, filed as news.
 *
 * The booking half (`booking-mail-queue.spec.ts`) makes the same argument at greater length, so
 * this file is short and asks only the questions that are different on this side of the table:
 *
 * A place is idempotent in a way a class minute is not. `POST /enrollments` twice is one place, and
 * the second press is answered with the row that already stood — so the queue has to learn the
 * difference *inside* the write, where it is visible, rather than from a caller who already forgot.
 *
 * A place can also be left and taken again, and that road is a genuinely new event on an old row.
 * The second joining files a second letter, because the student really is back in the course, while
 * the second leaving files none, because nobody left twice.
 *
 * And both go to the student alone. A teacher who wants to know who joined reads their roster, which
 * is a page with a count on it rather than a letter that has to be sent.
 *
 * As in the booking file, each test runs on its own course and the course title is the discriminator
 * — a queued row names no enrollment, so the copy's `{course_title}` is what ties it to its event.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();
let teacher: string;
let student: string;
let teacherId: string;
let studentId: string;

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

/** A course on this teacher's shelf. `draft` is the one the student cannot join, which is the
 * send decision that never happens as much as the two that do. */
async function course(options: { draft?: boolean } = {}): Promise<{ id: string; title: string }> {
  courseSequence += 1;
  const title = `Enrollment queue ${courseSequence} ${RUN}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title,
      slug: `enroll-queue-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'An hour of talking.',
      description: 'Talk about films, food and travel, with corrections as we go.',
    })
    .expect(201);
  const id = res.body.course.id as string;
  if (!options.draft) {
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${id}/publish`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
  }
  return { id, title };
}

async function enroll(courseId: string, token = student): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${token}`)
    .send({ courseId })
    .expect(200);
  return res.body.enrollment as { id: string };
}

async function leave(enrollmentId: string, token = student): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/enrollments/${enrollmentId}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.enrollment as { id: string };
}

/** The rows one event filed about one course, for one reader. */
async function filed(
  event: string,
  recipientId: string,
  courseTitle: string,
): Promise<MailOutbox[]> {
  const rows = await prisma.mailOutbox.findMany({
    where: { eventCode: event, recipientUserId: recipientId },
  });
  return rows.filter(
    (row) => (row.payload as { slots: Record<string, string> }).slots.course_title === courseTitle,
  );
}

const slotsOf = (row: MailOutbox) => (row.payload as { slots: Record<string, string> }).slots;

/** The answers each filed row carries — which is one way to assert the row count and its whole
 * payload at once, and the payload is the half that a reword cannot change without a test noticing. */
async function slotsFiled(
  event: string,
  recipientId: string,
  courseTitle: string,
): Promise<Record<string, string>[]> {
  return (await filed(event, recipientId, courseTitle)).map(slotsOf);
}

describe('the place news an enrollment write files', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('emiltr', 'teacher');
    student = await register('emillm', 'student');
    teacherId = await userIdFor('emiltr');
    studentId = await userIdFor('emillm');
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
    await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('tells the student they are in, and tells their teacher nothing', async () => {
    const { id, title } = await course();

    await enroll(id);

    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title)).toHaveLength(1);
    // A roster is a page with a count on it. A teacher who was mailed about every join would be
    // reading a list out of their inbox.
    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_JOINED, teacherId, title)).toHaveLength(0);
    expect(await slotsFiled(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title)).toEqual([
      { course_title: title, teacher_name: 'emiltr Person' },
    ]);
  });

  it('files one joining for a student who takes the same place twice', async () => {
    const { id, title } = await course();
    const place = await enroll(id);

    const again = await enroll(id);

    expect(again.id).toBe(place.id);
    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title)).toHaveLength(1);
  });

  it('tells a student who left that they left, once', async () => {
    const { id, title } = await course();
    const place = await enroll(id);

    await leave(place.id);
    await leave(place.id);

    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_LEFT, studentId, title)).toHaveLength(1);
    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_LEFT, teacherId, title)).toHaveLength(0);
    // The leaving copy asks for one answer, not two: there is nobody new to name in a message
    // whose whole subject is a place that is no longer there.
    expect(await slotsFiled(MAIL_EVENT_CODES.ENROLLMENT_LEFT, studentId, title)).toEqual([
      { course_title: title },
    ]);
  });

  it('tells a student who came back that they came back', async () => {
    const { id, title } = await course();
    const place = await enroll(id);
    await leave(place.id);

    // The same row, reopened: the place was genuinely lost and genuinely won again, which is two
    // pieces of news rather than a replay of one.
    const back = await enroll(id);
    expect(back.id).toBe(place.id);

    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title)).toHaveLength(2);
    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_LEFT, studentId, title)).toHaveLength(1);
  });

  it('files nothing for a course a student could not join', async () => {
    const { id, title } = await course({ draft: true });

    await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${student}`)
      .send({ courseId: id })
      .expect(404);

    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title)).toHaveLength(0);
  });

  it('files nothing for a place that is somebody else’s', async () => {
    const { id, title } = await course();
    const mine = await enroll(id);
    const other = await register('emill2', 'student');
    const otherId = await userIdFor('emill2');

    const res = await request(app.getHttpServer())
      .post(`/api/v1/enrollments/${mine.id}/cancel`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
    // Neither of them is told anything: the stranger's attempt changed no row, and the owner's
    // place is still open. A `enrollment_left` addressed to either would be a letter about an
    // event that a `404` already denied.
    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_LEFT, otherId, title)).toHaveLength(0);
    expect(await filed(MAIL_EVENT_CODES.ENROLLMENT_LEFT, studentId, title)).toHaveLength(0);
  });
});
