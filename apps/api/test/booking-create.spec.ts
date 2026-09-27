import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BOOKING_STATUS_CODES, BOOKING_TYPE_CODES, LKP_TYPE_CODES } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Booking a class: a student asks, and the minute is held until the teacher answers.
 *
 * The write is deliberately poor. A student sends a course and an instant and nothing else — not
 * a status (only a teacher confirms), not a kind (the entitlement the read already decided picks
 * `enrolled` or `demo`), not a duration (it is the window's, not the caller's). Everything the
 * request could have lied about is instead read from the two tables that own it.
 *
 * Three rules make the rest of the file:
 *
 * The instant has to be one the teacher's grid opened, in the horizon the calendar searches. A
 * student who posts a minute at random is not booking a class, they are asking the API to invent
 * one — and `slotAt` is the same arithmetic the slot list ran, so what was never offered
 * can never be taken.
 *
 * A minute is held for one class. Two students asking for the same instant is the race the unique
 * slot-hold index exists for; the answer is a conflict on the field the student was typing in,
 * not a 500 about a database key, and a second press by the *same* student is one event rather
 * than a fight with their own earlier row.
 *
 * And a request waits. A booking lands `pending` with the hold on it, because a teacher has to
 * say yes — the class is not on their calendar until they answer.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

const TEACHER_ZONE = 'Asia/Kolkata';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Slot {
  startsAt: string;
  endsAt: string;
}

interface Booking {
  id: string;
  course: { id: string };
  type: string;
  status: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
}

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

async function createPublishedCourse(
  teacher: string,
  options: { demos?: boolean } = {},
): Promise<{ id: string; slug: string }> {
  courseSequence += 1;
  const slug = `book-course-${courseSequence}-${RUN}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title: `Conversation club ${courseSequence} ${MARK}`,
      slug,
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
  if (options.demos) {
    await prisma.course.update({ where: { id }, data: { demoBookingsEnabled: true } });
  }
  return { id, slug };
}

/** Every day of the teacher's week, 09:00 to 10:00, one class. */
async function openDailyWeek(teacher: string) {
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await request(app.getHttpServer())
      .post('/api/v1/availability/rules')
      .set('Authorization', `Bearer ${teacher}`)
      .send({ weekday, startMinutes: 540, endMinutes: 600, slotMinutes: 60 })
      .expect(201);
  }
}

async function enroll(student: string, courseId: string) {
  await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${student}`)
    .send({ courseId })
    .expect(200);
}

function readSlots(token: string, course: string): request.Test {
  return request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course })
    .set('Authorization', `Bearer ${token}`);
}

/** The first class on the calendar — a minute the teacher really opened. */
async function firstSlot(token: string, course: string): Promise<Slot> {
  const res = await readSlots(token, course).expect(200);
  const slot = (res.body.slots as Slot[])[0];
  if (!slot) throw new Error('The calendar came back empty for a teacher with a daily window.');
  return slot;
}

function book(token: string | undefined, body: Record<string, unknown>): request.Test {
  const call = request(app.getHttpServer()).post('/api/v1/bookings').send(body);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function booked(token: string, body: Record<string, unknown>): Promise<Booking> {
  const res = await book(token, body).expect(200);
  return res.body.booking as Booking;
}

function validation(body: Record<string, unknown>): Record<string, string[]> {
  return (body.details as { validation: Record<string, string[]> }).validation;
}

const statusId = (code: string) =>
  prisma.lkpValue
    .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_STATUS } } })
    .then((row) => row.id);

const typeId = (code: string) =>
  prisma.lkpValue
    .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_TYPE } } })
    .then((row) => row.id);

/** A booking as the table wants it, for the states no endpoint has reached yet in this suite. */
async function writeBooking(args: {
  studentId: string;
  teacherId: string;
  courseId: string;
  startsAt: Date;
  type?: string;
  status?: string;
}) {
  const status = args.status ?? BOOKING_STATUS_CODES.PENDING;
  const blocking =
    status === BOOKING_STATUS_CODES.PENDING || status === BOOKING_STATUS_CODES.CONFIRMED;
  return prisma.booking.create({
    data: {
      studentUserId: args.studentId,
      teacherUserId: args.teacherId,
      courseId: args.courseId,
      typeValueId: await typeId(args.type ?? BOOKING_TYPE_CODES.ENROLLED),
      statusValueId: await statusId(status),
      startsAt: args.startsAt,
      durationMinutes: 60,
      slotHeldAt: blocking ? args.startsAt : null,
    },
  });
}

describe('booking a class', () => {
  let teacher: string;
  let teacherId: string;
  let member: string;
  let memberId: string;
  let outsider: string;
  let outsiderId: string;
  let rival: string;
  let rivalId: string;
  let course: { id: string; slug: string };
  let demoCourse: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('booktr', 'teacher');
    member = await register('bookmm', 'student');
    outsider = await register('bookou', 'student');
    rival = await register('bookrv', 'student');
    teacherId = await userIdFor('booktr');
    memberId = await userIdFor('bookmm');
    outsiderId = await userIdFor('bookou');
    rivalId = await userIdFor('bookrv');

    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });
    course = await createPublishedCourse(teacher);
    demoCourse = await createPublishedCourse(teacher, { demos: true });
    await openDailyWeek(teacher);
    await enroll(member, course.id);
    // A second student with a place, so "somebody else has this minute" can be tested against
    // somebody who is entitled to ask for it. The entitlement is answered first, and a stranger
    // asking for a taken minute is refused for the stranger's reason.
    await enroll(rival, course.id);
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

  it('takes a request, and holds the minute for it', async () => {
    const slot = await firstSlot(member, course.id);

    const booking = await booked(member, { course: course.id, startsAt: slot.startsAt });

    expect(booking).toMatchObject({
      course: { id: course.id },
      type: BOOKING_TYPE_CODES.ENROLLED,
      status: BOOKING_STATUS_CODES.PENDING,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      durationMinutes: 60,
    });
    // A pending request is a held minute and an unanswered one: the row is what keeps the class
    // off everybody else's calendar until the teacher says otherwise.
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.slotHeldAt?.toISOString()).toBe(slot.startsAt);
    expect(row.isActive).toBe(true);
    expect(Object.keys(booking).sort()).toEqual([
      'course',
      'createdAt',
      'durationMinutes',
      'endsAt',
      'id',
      'live',
      'startsAt',
      'status',
      'type',
      'updatedAt',
    ]);
  });

  it('gives the same answer twice to a student who presses the button twice', async () => {
    const slot = await firstSlot(member, course.id);

    const first = await booked(member, { course: course.id, startsAt: slot.startsAt });
    const second = await booked(member, { course: course.id, startsAt: slot.startsAt });

    expect(second.id).toBe(first.id);
    // Counted at that minute rather than in total: the earlier test left this student holding an
    // older class, and a term of weekly bookings is exactly a student with more than one row.
    expect(
      await prisma.booking.count({
        where: { studentUserId: memberId, courseId: course.id, startsAt: new Date(slot.startsAt) },
      }),
    ).toBe(1);
    // A double press is one event, so the route cannot answer "created" the first time and
    // "conflict" the second: the portal would have to know whether it had been clicked before.
  });

  it('refuses a minute another student is holding, on the field the student typed', async () => {
    const slot = await firstSlot(member, course.id);
    await booked(member, { course: course.id, startsAt: slot.startsAt });

    const res = await book(rival, { course: course.id, startsAt: slot.startsAt }).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body)).toMatch(/startsAt/i);
    expect(await prisma.booking.count({ where: { studentUserId: rivalId } })).toBe(0);
  });

  it('keeps one minute to one class across the whole shelf of one teacher', async () => {
    const slot = await firstSlot(member, course.id);
    await booked(member, { course: course.id, startsAt: slot.startsAt });

    // A different course of the same teacher, the same instant: the pool is the teacher's week,
    // and a student cannot be in two classes at once because the two are filed apart.
    await enroll(member, demoCourse.id);
    const res = await book(member, { course: demoCourse.id, startsAt: slot.startsAt }).expect(409);

    expect(res.body.code).toBe('CONFLICT');
  });

  it('refuses an instant the teacher never opened', async () => {
    // Ten past nine is inside Monday's window but is not a class start: the window tiles at
    // 09:00 with a sixty-minute class, and the grid is the only thing a booking may name.
    const slot = await firstSlot(member, course.id);
    const midClass = new Date(new Date(slot.startsAt).getTime() + 10 * 60_000).toISOString();

    const res = await book(member, { course: course.id, startsAt: midClass }).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(validation(res.body).startsAt).toBeDefined();
  });

  it('refuses a minute that has already gone by', async () => {
    const yesterday = new Date(Date.now() - MS_PER_DAY).toISOString();

    const res = await book(member, { course: course.id, startsAt: yesterday }).expect(400);

    expect(validation(res.body).startsAt).toBeDefined();
  });

  it('refuses a minute further ahead than the calendar looks', async () => {
    // Two months out is a minute the teacher's windows do open on, but the platform is not
    // willing to hold a class it has never shown anybody.
    const slot = await firstSlot(member, course.id);
    const far = new Date(new Date(slot.startsAt).getTime() + 60 * MS_PER_DAY).toISOString();

    const res = await book(member, { course: course.id, startsAt: far }).expect(400);

    expect(validation(res.body).startsAt).toBeDefined();
  });

  it('will not take a status, a kind or a duration from the student', async () => {
    await prisma.booking.deleteMany({ where: { studentUserId: memberId } });
    const slot = await firstSlot(member, course.id);

    await book(member, {
      course: course.id,
      startsAt: slot.startsAt,
      status: BOOKING_STATUS_CODES.CONFIRMED,
    }).expect(400);
    await book(member, {
      course: course.id,
      startsAt: slot.startsAt,
      type: 'placement_interview',
    }).expect(400);
    await book(member, {
      course: course.id,
      startsAt: slot.startsAt,
      durationMinutes: 180,
    }).expect(400);

    expect(await prisma.booking.count({ where: { studentUserId: memberId } })).toBe(0);
  });

  it('opens a demo booking to a student with no place, when the teacher allows it', async () => {
    const slot = await firstSlot(outsider, demoCourse.id);

    const booking = await booked(outsider, { course: demoCourse.id, startsAt: slot.startsAt });

    expect(booking).toMatchObject({
      type: BOOKING_TYPE_CODES.DEMO,
      status: BOOKING_STATUS_CODES.PENDING,
    });
  });

  it('gives a student one demo per course, and the cancelled one still counts', async () => {
    await prisma.booking.deleteMany({ where: { studentUserId: outsiderId } });
    const taken = await firstSlot(outsider, demoCourse.id);
    await writeBooking({
      studentId: outsiderId,
      teacherId,
      courseId: demoCourse.id,
      startsAt: new Date(taken.startsAt),
      type: BOOKING_TYPE_CODES.DEMO,
      status: BOOKING_STATUS_CODES.CANCELLED,
    });

    // The cancelled class released its minute, so the grid would offer that time again to anyone
    // else — but the cap is about the student having tried this teacher once, not about the minute
    // being free, and a cancelled trial was still a trial.
    const res = await book(outsider, {
      course: demoCourse.id,
      startsAt: taken.startsAt,
    }).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body)).toMatch(/demo/i);
    expect(await prisma.booking.count({ where: { studentUserId: outsiderId } })).toBe(1);
  });

  it('refuses a stranger a class in a course that keeps its calendar to the class', async () => {
    const slot = await firstSlot(member, course.id);

    const res = await book(outsider, { course: course.id, startsAt: slot.startsAt }).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body)).toMatch(/enroll/i);
    expect(
      await prisma.booking.count({ where: { studentUserId: outsiderId, courseId: course.id } }),
    ).toBe(0);
  });

  it('counts a place ahead of a demo', async () => {
    await prisma.booking.deleteMany({ where: { studentUserId: memberId } });
    await enroll(member, demoCourse.id);
    const slot = await firstSlot(member, demoCourse.id);

    const booking = await booked(member, { course: demoCourse.id, startsAt: slot.startsAt });

    expect(booking.type).toBe(BOOKING_TYPE_CODES.ENROLLED);
  });

  it('will not book a course the shelf does not carry', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${teacher}`)
      .send({
        title: `Not published ${MARK}`,
        slug: `not-published-${RUN}`,
        level: 'beginner',
        summary: 'Still being written.',
        description: 'Still being written, at length, in a form nobody can book.',
      })
      .expect(201);
    const slot = await firstSlot(member, course.id);

    const neverWritten = await book(member, {
      course: randomUUID(),
      startsAt: slot.startsAt,
    }).expect(404);
    const unpublished = await book(member, {
      course: draft.body.course.id,
      startsAt: slot.startsAt,
    }).expect(404);

    expect(neverWritten.body.message).toBe(unpublished.body.message);
  });

  it('accepts the slug a link carries', async () => {
    await prisma.booking.deleteMany({ where: { studentUserId: memberId } });
    const slot = await firstSlot(member, course.id);

    const booking = await booked(member, { course: course.slug, startsAt: slot.startsAt });

    expect(booking.course.id).toBe(course.id);
  });

  it('asks for a minute in a form it can read', async () => {
    const res = await book(member, { course: course.id, startsAt: 'tomorrow morning' }).expect(400);

    expect(validation(res.body).startsAt).toBeDefined();
  });

  it('refuses a caller with no session, and a teacher with a student route', async () => {
    const slot = await firstSlot(member, course.id);

    await book(undefined, { course: course.id, startsAt: slot.startsAt }).expect(401);
    await book(teacher, { course: course.id, startsAt: slot.startsAt }).expect(403);
  });
});
