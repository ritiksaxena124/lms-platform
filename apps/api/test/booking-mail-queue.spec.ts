import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type MailOutbox } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BOOKING_STATUS_CODES,
  LKP_TYPE_CODES,
  MAIL_EVENT_CODES,
  PENDING_REQUEST_HOURS,
} from '@lms/shared';
import { AppModule } from '../src/app.module';
import { BookingExpiryService } from '../src/modules/bookings/booking-expiry.service';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The five things this platform can decide about a class, filed as news while the decision is made.
 *
 * The queue's own spec (`mail-queue.spec.ts`) already answers *what a filed row holds* — who reads
 * it, which page its button opens, which answers the copy will ask for. This file asks the question
 * one level out, which no unit of the queue can answer on its own: **does the write that makes the
 * news file it, and does the write that does not make the news file nothing?**
 *
 * That second half is the reason a row is filed inside the transaction rather than after it, and so
 * it is the half worth the tests:
 *
 * - A student pressing the book button twice gets one row. The second press is the same request
 *   replayed, and a teacher told twice about one ask is a teacher learning that the queue lies.
 * - A teacher confirming a class that was already confirmed gets one row, for the same reason.
 * - A write that is refused — the 409 on an already-answered request, the 409 on a minute that is
 *   no longer free — files nothing, because nothing happened.
 * - The expiry sweep files one row per request it *ended*, addressed to the student who asked for
 *   that one. That is why it moves rows one at a time rather than in a single statement.
 *
 * Each test runs on its own course, and the course title is the discriminator: a queued row names
 * no booking, by design (it is news about a class, not a pointer into the booking table), so the
 * copy's own `{course_title}` is what ties a row back to the event that filed it.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

const TEACHER_ZONE = 'Asia/Kolkata';
const MS_PER_HOUR = 60 * 60 * 1000;

interface Slot {
  startsAt: string;
}

interface Booking {
  id: string;
  startsAt: string;
}

let app: INestApplication;
const prisma = new PrismaClient();
let expiry: BookingExpiryService;
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

/** A course on the shelf with a place taken in it by the student this file books as by default. Its
 * title is this file's marker for one test's worth of news. */
async function openCourse(): Promise<{ id: string; title: string }> {
  courseSequence += 1;
  const title = `Queue course ${courseSequence} ${RUN}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title,
      slug: `queue-course-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'An hour of talking.',
      description: 'Talk about films, food and travel, with corrections as we go.',
    })
    .expect(201);
  const id = res.body.course.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${teacher}`)
    .expect(200);
  await enroll(student, id);
  return { id, title };
}

async function enroll(token: string, courseId: string): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${token}`)
    .send({ courseId })
    .expect(200);
}

/** The next minute this course's teacher offers this student, failing loudly on an empty grid rather
 * than letting an `undefined.startsAt` stand in for a horizon that never arrived. */
async function nextSlot(token: string, courseId: string): Promise<Slot> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course: courseId })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const [slot] = res.body.slots as Slot[];
  if (!slot) throw new Error('The horizon came back empty for a teacher with a daily window.');
  return slot;
}

async function booked(token: string, courseId: string, startsAt: string): Promise<Booking> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ course: courseId, startsAt })
    .expect(200);
  return res.body.booking as Booking;
}

/** Ask for a class in a course of this file's own — the shortest road to one send decision. */
async function askForAClass(): Promise<{
  course: { id: string; title: string };
  booking: Booking;
}> {
  const course = await openCourse();
  const slot = await nextSlot(student, course.id);
  const booking = await booked(student, course.id, slot.startsAt);
  return { course, booking };
}

function answer(verb: 'confirm' | 'reject', id: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/bookings/${id}/${verb}`)
    .set('Authorization', `Bearer ${teacher}`);
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

/** Time passing for a request the teacher never answered. Backdated, as the expiry spec does: a
 * sweep is global, and a future clock would expire other suites' rows mid-flight. */
async function waitingSince(id: string, hours: number): Promise<void> {
  await prisma.booking.update({
    where: { id },
    data: { createdAt: new Date(Date.now() - hours * MS_PER_HOUR) },
  });
}

const statusId = (code: string) =>
  prisma.lkpValue
    .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_STATUS } } })
    .then((row) => row.id);

describe('the class news a booking write files', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    expiry = app.get(BookingExpiryService);

    teacher = await register('bmiltr', 'teacher');
    student = await register('bmillm', 'student');
    teacherId = await userIdFor('bmiltr');
    studentId = await userIdFor('bmillm');
    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });

    // One week of 09:00 classes is the whole grid this file books out of; every test takes the next
    // free minute from it, so no two tests ever stand in the same one.
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/availability/rules')
        .set('Authorization', `Bearer ${teacher}`)
        .send({ weekday, startMinutes: 540, endMinutes: 600, slotMinutes: 60 })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    // First of the deletes, because the queue points at a person, and the table refuses to let a
    // recipient go while a row still names them.
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.booking.deleteMany({
      where: { OR: [{ studentUserId: { in: userIds } }, { teacherUserId: { in: userIds } }] },
    });
    await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
    await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('tells the teacher about a request, and tells the student nothing yet', async () => {
    const { course } = await askForAClass();

    const asked = await filed(MAIL_EVENT_CODES.BOOKING_REQUESTED, teacherId, course.title);
    expect(asked).toHaveLength(1);
    // The student asked; nobody needs to tell them they asked. And a request is not an answer, so no
    // confirmation is waiting for them either.
    expect(await filed(MAIL_EVENT_CODES.BOOKING_REQUESTED, studentId, course.title)).toHaveLength(
      0,
    );
    expect(await filed(MAIL_EVENT_CODES.BOOKING_CONFIRMED, studentId, course.title)).toHaveLength(
      0,
    );
    expect((asked[0]?.payload as { slots: Record<string, string> }).slots.student_name).toBe(
      'bmillm Person',
    );
  });

  it('files one request for a student who presses the button twice', async () => {
    const { course, booking } = await askForAClass();
    const twice = await booked(student, course.id, booking.startsAt);

    expect(twice.id).toBe(booking.id);
    expect(await filed(MAIL_EVENT_CODES.BOOKING_REQUESTED, teacherId, course.title)).toHaveLength(
      1,
    );
  });

  it('files nothing for a minute that was already taken', async () => {
    const { course, booking } = await askForAClass();
    const other = await register('bmill2', 'student');
    const otherId = await userIdFor('bmill2');
    await enroll(other, course.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${other}`)
      .send({ course: course.id, startsAt: booking.startsAt })
      .expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(await filed(MAIL_EVENT_CODES.BOOKING_REQUESTED, otherId, course.title)).toHaveLength(0);
    // The first student's news is still the only thing this course has said.
    expect(await filed(MAIL_EVENT_CODES.BOOKING_REQUESTED, teacherId, course.title)).toHaveLength(
      1,
    );
  });

  it('tells the student what their teacher said, and only once per answer', async () => {
    const { course, booking } = await askForAClass();
    await answer('confirm', booking.id).expect(200);
    await answer('confirm', booking.id).expect(200);

    expect(await filed(MAIL_EVENT_CODES.BOOKING_CONFIRMED, studentId, course.title)).toHaveLength(
      1,
    );
    expect(await filed(MAIL_EVENT_CODES.BOOKING_CONFIRMED, teacherId, course.title)).toHaveLength(
      0,
    );

    // A refusal that lands on an already-confirmed class is a 409 and no news: the row did not move.
    await answer('reject', booking.id).expect(409);
    expect(await filed(MAIL_EVENT_CODES.BOOKING_REFUSED, studentId, course.title)).toHaveLength(0);
  });

  it('tells the student a refusal, and tells them the teacher never answered', async () => {
    const refused = await askForAClass();
    await answer('reject', refused.booking.id).expect(200);
    expect(
      await filed(MAIL_EVENT_CODES.BOOKING_REFUSED, studentId, refused.course.title),
    ).toHaveLength(1);

    const silent = await askForAClass();
    await waitingSince(silent.booking.id, PENDING_REQUEST_HOURS + 1);
    await expiry.expireStale(new Date());
    expect(
      await filed(MAIL_EVENT_CODES.BOOKING_EXPIRED, studentId, silent.course.title),
    ).toHaveLength(1);
  });

  it('tells the teacher when a student leaves a class', async () => {
    const { course, booking } = await askForAClass();
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${student}`)
      .expect(200);

    expect(await filed(MAIL_EVENT_CODES.BOOKING_CANCELLED, teacherId, course.title)).toHaveLength(
      1,
    );
    // The student is the one who said it; a letter telling them they left is a receipt, and what
    // this queue files is news.
    expect(await filed(MAIL_EVENT_CODES.BOOKING_CANCELLED, studentId, course.title)).toHaveLength(
      0,
    );
  });

  it('ends two requests, and tells each student about the one that was theirs', async () => {
    const mine = await askForAClass();
    await waitingSince(mine.booking.id, PENDING_REQUEST_HOURS + 4);

    const course = await openCourse();
    const other = await register('bmill3', 'student');
    const otherId = await userIdFor('bmill3');
    await enroll(other, course.id);
    const theirs = await booked(other, course.id, (await nextSlot(other, course.id)).startsAt);
    await waitingSince(theirs.id, PENDING_REQUEST_HOURS + 4);

    const swept = await expiry.expireStale(new Date());

    expect(swept).toBeGreaterThanOrEqual(2);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: theirs.id } })).statusValueId,
    ).toBe(await statusId(BOOKING_STATUS_CODES.EXPIRED));
    // Two rows ended, two letters, and neither addressed to both students. A sweep that filed one
    // row per teacher — or filed the same row twice — would satisfy a count and go unnoticed until
    // somebody wrote in about a class they were never in.
    expect(
      await filed(MAIL_EVENT_CODES.BOOKING_EXPIRED, studentId, mine.course.title),
    ).toHaveLength(1);
    expect(await filed(MAIL_EVENT_CODES.BOOKING_EXPIRED, otherId, course.title)).toHaveLength(1);
    expect(await filed(MAIL_EVENT_CODES.BOOKING_EXPIRED, studentId, course.title)).toHaveLength(0);
    expect(await filed(MAIL_EVENT_CODES.BOOKING_EXPIRED, otherId, mine.course.title)).toHaveLength(
      0,
    );

    // A second sweep has already ended these two, so it has nothing to say about them again. This is
    // the whole reason the sweep moves rows one at a time: a single `updateMany` reports a count
    // without ever learning which rows it was a count of.
    await expiry.expireStale(new Date());
    expect(
      await filed(MAIL_EVENT_CODES.BOOKING_EXPIRED, studentId, mine.course.title),
    ).toHaveLength(1);
  });

  it('has nothing to say about a request the sweep left standing', async () => {
    const { course } = await askForAClass();

    await expiry.expireStale(new Date());

    expect(await filed(MAIL_EVENT_CODES.BOOKING_EXPIRED, studentId, course.title)).toHaveLength(0);
  });

  it('keeps the address out of the queue, and the room out of both', async () => {
    const { booking } = await askForAClass();
    await answer('confirm', booking.id).expect(200);

    const rows = await prisma.mailOutbox.findMany({
      where: { recipientUserId: { in: [teacherId, studentId] } },
    });
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows);
    // 6a's port owns the address book and the queue names a recipient by id; a stored address would
    // go stale the day a person changed it. The room is the other half: a Jitsi URL is a secret with
    // a URL's shape, and there is no path a notification writes that it could arrive through (§10).
    for (const secret of [emailFor('bmiltr'), emailFor('bmillm'), 'meet.jit.si', booking.id]) {
      expect(serialized.includes(secret), secret).toBe(false);
    }
    expect(serialized).not.toMatch(/password|token|secret/i);
  });
});
