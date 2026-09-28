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
 * Leaving a class, and looking back at the ones a student has.
 *
 * A cancel is a release, not a deletion. The row keeps its identity and takes a status, because
 * "this student booked this minute and then let it go" is a fact the teacher's attendance and the
 * demo cap both still need — and the minute itself goes back on the calendar the same write,
 * because holding a seat nobody will sit in is the one thing a cancel must not do.
 *
 * So the two states a released minute can be in are the two things this file checks hardest: the
 * grid offering that time again to whoever asks next, and a cancelled *demo* still being spent.
 * The cap counts the student's history with the course, not the standing rows, or a student could
 * take a trial call, cancel it, and take another one as many times as they liked.
 *
 * The list is the same rows read the other way: everything about this student's relationship with
 * every teacher, soonest first, in every status. Nothing here decides what a class means — a
 * screen that wants "upcoming" filters on the start it is given, and a screen that wants history
 * reads the rows below it.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

const TEACHER_ZONE = 'Asia/Kolkata';
const MS_PER_MINUTE = 60 * 1000;

interface Slot {
  startsAt: string;
  endsAt: string;
}

interface Booking {
  id: string;
  course: { id: string; slug: string; title: string };
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
): Promise<{ id: string; slug: string; title: string }> {
  courseSequence += 1;
  const slug = `leave-course-${courseSequence}-${RUN}`;
  const title = `Conversation club ${courseSequence} ${MARK}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title,
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
  return { id, slug, title };
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

/** The next minute this student can take, which is never one they are already holding. */
async function firstSlot(token: string, course: string): Promise<Slot> {
  const res = await readSlots(token, course).expect(200);
  const slot = (res.body.slots as Slot[])[0];
  if (!slot) throw new Error('The calendar came back empty for a teacher with a daily window.');
  return slot;
}

async function slotList(token: string, course: string): Promise<string[]> {
  const res = await readSlots(token, course).expect(200);
  return (res.body.slots as Slot[]).map((slot) => slot.startsAt);
}

async function booked(token: string, course: string, startsAt: string): Promise<Booking> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ course, startsAt })
    .expect(200);
  return res.body.booking as Booking;
}

function cancel(token: string | undefined, id: string): request.Test {
  const call = request(app.getHttpServer()).post(`/api/v1/bookings/${id}/cancel`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function myBookings(token: string): Promise<Booking[]> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.bookings as Booking[];
}

const statusId = (code: string) =>
  prisma.lkpValue
    .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_STATUS } } })
    .then((row) => row.id);

const typeId = (code: string) =>
  prisma.lkpValue
    .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_TYPE } } })
    .then((row) => row.id);

/** A booking in a state no student or teacher route can put a row in yet — a class that has
 * already happened, which is the one thing a cancel must not be able to undo. */
async function writeFinishedBooking(args: {
  studentId: string;
  teacherId: string;
  courseId: string;
  startsAt: Date;
  status: string;
}) {
  return prisma.booking.create({
    data: {
      studentUserId: args.studentId,
      teacherUserId: args.teacherId,
      courseId: args.courseId,
      typeValueId: await typeId(BOOKING_TYPE_CODES.ENROLLED),
      statusValueId: await statusId(args.status),
      startsAt: args.startsAt,
      durationMinutes: 60,
      slotHeldAt: null,
    },
  });
}

describe('leaving a class', () => {
  let teacher: string;
  let teacherId: string;
  let member: string;
  let memberId: string;
  let other: string;
  let course: { id: string; slug: string; title: string };
  let demoCourse: { id: string; slug: string; title: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('leavtr', 'teacher');
    member = await register('leavmm', 'student');
    other = await register('leavot', 'student');
    teacherId = await userIdFor('leavtr');
    memberId = await userIdFor('leavmm');

    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });
    course = await createPublishedCourse(teacher);
    demoCourse = await createPublishedCourse(teacher, { demos: true });
    await openDailyWeek(teacher);
    await enroll(member, course.id);
    await enroll(other, course.id);
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
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('lets a student go, and puts the minute back on the calendar', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);

    const res = await cancel(member, booking.id).expect(200);

    expect((res.body.booking as Booking).status).toBe(BOOKING_STATUS_CODES.CANCELLED);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    // The row survives and the claim does not: a cancelled class is a fact about last month, and
    // the minute it occupied belongs to the teacher again.
    expect(row.isActive).toBe(true);
    expect(row.slotHeldAt).toBeNull();
    expect(await slotList(member, course.id)).toContain(slot.startsAt);
  });

  it('answers a second cancel with the same cancelled class', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await cancel(member, booking.id).expect(200);

    const twice = await cancel(member, booking.id).expect(200);

    expect((twice.body.booking as Booking).id).toBe(booking.id);
    expect((twice.body.booking as Booking).status).toBe(BOOKING_STATUS_CODES.CANCELLED);
    expect(await prisma.booking.count({ where: { id: booking.id } })).toBe(1);
  });

  it('counts a cancelled demo as the demo it was', async () => {
    const slot = await firstSlot(other, demoCourse.id);
    const booking = await booked(other, demoCourse.id, slot.startsAt);
    expect(booking.type).toBe(BOOKING_TYPE_CODES.DEMO);
    await cancel(other, booking.id).expect(200);

    const calendar = await readSlots(other, demoCourse.id).expect(200);
    expect(calendar.body.entitlement).toBe('none');
    expect(calendar.body.denial).toBe('demo_already_taken');

    // And the write agrees with the read rather than letting a fresh minute look like a fresh
    // trial: the next day's class is on the grid, and this student cannot take it either.
    const next = new Date(new Date(slot.startsAt).getTime() + 24 * 60 * 60 * MS_PER_MINUTE);
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${other}`)
      .send({ course: demoCourse.id, startsAt: next.toISOString() })
      .expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body)).toMatch(/demo/i);
  });

  it('will not let a student out of a class that has already happened', async () => {
    const finished = await writeFinishedBooking({
      studentId: memberId,
      teacherId,
      courseId: course.id,
      startsAt: new Date(Date.now() - 24 * 60 * 60 * MS_PER_MINUTE),
      status: BOOKING_STATUS_CODES.COMPLETED,
    });

    const res = await cancel(member, finished.id).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: finished.id } });
    expect(await statusId(BOOKING_STATUS_CODES.COMPLETED)).toBe(row.statusValueId);
  });

  it('refuses somebody else’s class, and an invented one, with the same answer', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);

    const strangers = await cancel(other, booking.id).expect(404);
    const nothing = await cancel(other, randomUUID()).expect(404);

    expect(nothing.body.message).toBe(strangers.body.message);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.PENDING));
  });

  it('shows a student their own classes, soonest first', async () => {
    await prisma.booking.deleteMany({ where: { studentUserId: memberId } });
    const earlier = await firstSlot(member, course.id);
    await booked(member, course.id, earlier.startsAt);
    // Taken after the first is held, so this is genuinely the next class rather than the same
    // minute read twice.
    const later = await firstSlot(member, course.id);
    expect(later.startsAt).not.toBe(earlier.startsAt);
    const held = await booked(member, course.id, later.startsAt);
    await booked(other, course.id, (await firstSlot(other, course.id)).startsAt);

    const list = await myBookings(member);

    expect(list.map((entry) => entry.startsAt)).toEqual([earlier.startsAt, later.startsAt]);
    const keys = Object.keys(list[0] ?? {}).sort();
    expect(keys).toEqual([
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
    expect(list[0]?.course).toMatchObject({
      id: course.id,
      slug: course.slug,
      title: course.title,
    });
    expect(list.some((entry) => entry.id === held.id)).toBe(true);
  });

  it('keeps the cancelled classes in the list a student reads', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await cancel(member, booking.id).expect(200);

    const list = await myBookings(member);

    // A leave is not an erasure. The screen sorts them into upcoming and past; this endpoint's
    // job is to say what happened, including the times this student decided not to come.
    expect(list.filter((entry) => entry.id === booking.id)).toHaveLength(1);
  });

  it('asks who is reading before it shows anybody a calendar', async () => {
    const call = request(app.getHttpServer()).get('/api/v1/bookings');
    await call.expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${teacher}`)
      .expect(403);
  });
});
