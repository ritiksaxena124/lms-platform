import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTION_CODES, BOOKING_STATUS_CODES, LKP_TYPE_CODES } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The two words that end a booked class: it happened, or it did not.
 *
 * A cohort class has a roll because it has a room full of names, and who stood for each of them is
 * a row under the class. A one-to-one has one name, and that name is the class — so its attendance
 * is not a sheet beside the booking but the booking's own status. `completed` and `no_show` were
 * seeded in Phase 4 for exactly this, and until this door nothing in the platform could write them:
 * a confirmed class stayed confirmed forever, and a teacher's own calendar could not say which of
 * last week's lessons they actually taught.
 *
 * Four rules hold the door shut, and three of them are the roll's, carried over rather than
 * reinvented so that the two ways of marking a class agree about when marking is possible.
 *
 * The class has to have begun. Attendance is a report about an event, and a report filed before the
 * event is a prediction the platform has no door for. The instant it is judged against is the row's
 * own start and not its end: a teacher who ran a short lesson, or who sat in an empty room and gave
 * up on it, knows how it finished before the clock does.
 *
 * Only a confirmed class can be marked. A request nobody answered, a refusal, an expiry and a
 * cancellation each have a state of their own that says what happened to them, and putting `no_show`
 * over any of them would be reporting a class that never stood as one that was missed.
 *
 * The mark is the teacher's. They are the one who was in the room, so this route sits behind
 * `booking:answer` beside the confirm and the refuse, and a student pressing it gets the same 403
 * the request queue gives them.
 *
 * And a pressed mark is not a rewrite of a mark already given. The same word twice answers with the
 * class as it stands and files one record, because a lost response is a retry rather than a second
 * decision; a *different* word is refused, because a class cannot have both happened and not
 * happened, and the teacher who changes their mind about last Tuesday is correcting a record rather
 * than pressing a button twice.
 *
 * ## Why the fixtures are aged and the clock is never moved
 *
 * The grid only ever offers minutes that have not arrived, so a class that has already happened
 * cannot be booked and then waited for. Each test books and confirms through the real doors, then
 * moves that row's own `startsAt` — and with it the minute it holds — behind the present. The clock
 * the route reads is left alone: an earlier clock would make every other spec's future classes
 * look like history, which is the same reason the expiry sweep is called with a moment rather than
 * with the database backdated.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;
const MS_PER_MINUTE = 60_000;

interface Slot {
  startsAt: string;
  endsAt: string;
}

interface Booking {
  id: string;
  course: { id: string; slug: string; title: string };
  type: string;
  status: string;
  live: { opensAt: string; closesAt: string } | null;
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

async function createPublishedCourse(teacher: string): Promise<{ id: string; slug: string }> {
  courseSequence += 1;
  const slug = `attend-course-${courseSequence}-${RUN}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title: `Attendance clinic ${courseSequence} ${MARK}`,
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

async function firstSlot(token: string, course: string): Promise<Slot> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const slot = (res.body.slots as Slot[])[0];
  if (!slot) throw new Error('The calendar came back empty for a teacher with a daily window.');
  return slot;
}

async function booked(token: string, course: string, startsAt: string): Promise<Booking> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ course, startsAt })
    .expect(200);
  return res.body.booking as Booking;
}

async function answered(token: string, verb: 'confirm' | 'reject', id: string): Promise<Booking> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/bookings/${id}/${verb}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.booking as Booking;
}

/** A class's own minute, moved behind the present — and the row as the table now holds it.
 *
 * The minute it holds moves with its start, because a booking whose start is in the past and whose
 * hold is still in the future is a row this fixture invented rather than one the platform writes,
 * and the release the mark claims to make is worth asserting against a hold that was real. Each call
 * lands on a different instant: a teacher cannot hold one minute twice, and the two halves of that
 * key are the teacher and the instant. */
let aged = 0;

async function sendIntoThePast(id: string): Promise<{ id: string; startsAt: string }> {
  aged += 1;
  const past = new Date(Date.now() - aged * 121 * MS_PER_MINUTE);
  await prisma.booking.update({ where: { id }, data: { startsAt: past, slotHeldAt: past } });
  const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
  return { id, startsAt: row.startsAt.toISOString() };
}

function mark(token: string | undefined, id: string, status: string): request.Test {
  const call = request(app.getHttpServer())
    .post(`/api/v1/bookings/${id}/attendance`)
    .send({ status });
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function marked(token: string, id: string, status: string): Promise<Booking> {
  const res = await mark(token, id, status).expect(200);
  return res.body.booking as Booking;
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

/** The ledger rows one press filed, found by the request id the response carries. */
async function filedBy(response: request.Response) {
  return prisma.actionLog.findMany({
    where: { requestId: response.headers['x-request-id'] as string },
    orderBy: { createdAt: 'asc' },
  });
}

describe('marking off a booked class', () => {
  let teacher: string;
  let teacherId: string;
  let other: string;
  let member: string;
  let memberId: string;
  let course: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('attnttr', 'teacher');
    other = await register('attnotr', 'teacher');
    member = await register('attnmem', 'student');

    teacherId = await userIdFor('attnttr');
    memberId = await userIdFor('attnmem');
    await prisma.user.update({ where: { id: teacherId }, data: { timezone: 'Asia/Kolkata' } });

    course = await createPublishedCourse(teacher);
    await createPublishedCourse(other);
    await openDailyWeek(teacher);
    await openDailyWeek(other);
    await enroll(member, course.id);
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
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  /** A confirmed class whose minute has gone by, reached the way a class is really reached. */
  async function pastClass(): Promise<{ id: string; startsAt: string }> {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    const confirmed = await answered(teacher, 'confirm', booking.id);
    return sendIntoThePast(confirmed.id);
  }

  it('marks a class that has happened as taught, and closes it', async () => {
    const booking = await pastClass();

    const res = await mark(teacher, booking.id, BOOKING_STATUS_CODES.COMPLETED).expect(200);
    const marked = res.body.booking as Booking;

    expect(marked.id).toBe(booking.id);
    expect(marked.status).toBe(BOOKING_STATUS_CODES.COMPLETED);
    // The door goes with the class: a room nobody is coming to is not a door, whatever the row
    // still remembers about the one it had.
    expect(marked.live).toBeNull();
    expect(marked.startsAt).toBe(booking.startsAt);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.COMPLETED));
    // A taught class gives its minute back, which is what the blocking-status list has always said
    // it does — and the row survives the mark, because a class that was held is a fact.
    expect(row.slotHeldAt).toBeNull();
    expect(row.isActive).toBe(true);

    const [record] = await filedBy(res);
    expect(record).toMatchObject({
      actionCode: ACTION_CODES.BOOKING_COMPLETED,
      targetId: booking.id,
      actorUserId: teacherId,
      detail: { from: BOOKING_STATUS_CODES.CONFIRMED, to: BOOKING_STATUS_CODES.COMPLETED },
    });
  });

  it('marks a class the student never came to as missed', async () => {
    const booking = await pastClass();

    const res = await mark(teacher, booking.id, BOOKING_STATUS_CODES.NO_SHOW).expect(200);

    expect((res.body.booking as Booking).status).toBe(BOOKING_STATUS_CODES.NO_SHOW);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.NO_SHOW));
    expect(row.slotHeldAt).toBeNull();

    const [record] = await filedBy(res);
    expect(record).toMatchObject({
      actionCode: ACTION_CODES.BOOKING_NO_SHOW,
      detail: { from: BOOKING_STATUS_CODES.CONFIRMED, to: BOOKING_STATUS_CODES.NO_SHOW },
    });
  });

  it('tells the student how their own class ended', async () => {
    const booking = await pastClass();
    await marked(teacher, booking.id, BOOKING_STATUS_CODES.COMPLETED);

    const mine = await myBookings(member);
    const row = mine.find((entry) => entry.id === booking.id);

    expect(row).toMatchObject({ status: BOOKING_STATUS_CODES.COMPLETED, live: null });
  });

  it('answers a second press of the same word with the class as it stands', async () => {
    const booking = await pastClass();
    const first = await marked(teacher, booking.id, BOOKING_STATUS_CODES.NO_SHOW);

    const twice = await mark(teacher, booking.id, BOOKING_STATUS_CODES.NO_SHOW).expect(200);

    expect(twice.body.booking).toMatchObject({
      id: booking.id,
      status: first.status,
    });
    expect(await prisma.booking.count({ where: { id: booking.id } })).toBe(1);
    // One decision, one record: the retry is the same answer arriving twice, and a ledger holding
    // both copies would tell an operator the teacher marked the class twice.
    const rows = await prisma.actionLog.findMany({
      where: { targetId: booking.id, actionCode: ACTION_CODES.BOOKING_NO_SHOW },
    });
    expect(rows).toHaveLength(1);
  });

  it('will not mark a class that has not started', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await answered(teacher, 'confirm', booking.id);

    const res = await mark(teacher, booking.id, BOOKING_STATUS_CODES.COMPLETED).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toMatch(/not started/i);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.CONFIRMED));
    expect(row.slotHeldAt?.toISOString()).toBe(slot.startsAt);
  });

  it('will not mark a class that is not a standing confirmed one', async () => {
    // A request nobody has answered yet.
    const pending = await booked(member, course.id, (await firstSlot(member, course.id)).startsAt);
    // A class the teacher refused.
    const refusedAsk = await booked(member, course.id, (await firstSlot(member, course.id)).startsAt);
    await answered(teacher, 'reject', refusedAsk.id);
    // A class the student left.
    const left = await booked(member, course.id, (await firstSlot(member, course.id)).startsAt);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${left.id}/cancel`)
      .set('Authorization', `Bearer ${member}`)
      .expect(200);
    // A request nobody answered *and* whose minute has gone by: the teacher's silence is not a
    // class that was missed, and the sweep has its own word for this.
    const unanswered = await booked(
      member,
      course.id,
      (await firstSlot(member, course.id)).startsAt,
    );
    await sendIntoThePast(unanswered.id);

    for (const id of [pending.id, refusedAsk.id, left.id, unanswered.id]) {
      const res = await mark(teacher, id, BOOKING_STATUS_CODES.COMPLETED).expect(409);
      expect(res.body.code).toBe('CONFLICT');
    }

    // None of them moved. Read as one map rather than four queries: the table owes no order to a
    // `findMany`, and a list compared element by element would be a test failing on a sort.
    const after = await prisma.booking.findMany({
      where: { id: { in: [pending.id, refusedAsk.id, left.id, unanswered.id] } },
      select: { id: true, statusValueId: true },
    });
    const statusOf = new Map(after.map((row) => [row.id, row.statusValueId]));
    expect(statusOf.get(pending.id)).toBe(await statusId(BOOKING_STATUS_CODES.PENDING));
    expect(statusOf.get(refusedAsk.id)).toBe(await statusId(BOOKING_STATUS_CODES.REJECTED));
    expect(statusOf.get(left.id)).toBe(await statusId(BOOKING_STATUS_CODES.CANCELLED));
    expect(statusOf.get(unanswered.id)).toBe(await statusId(BOOKING_STATUS_CODES.PENDING));
  });

  it('will not say a class both happened and did not', async () => {
    const booking = await pastClass();
    await marked(teacher, booking.id, BOOKING_STATUS_CODES.COMPLETED);

    const res = await mark(teacher, booking.id, BOOKING_STATUS_CODES.NO_SHOW).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toMatch(/already/i);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.COMPLETED));
  });

  it('refuses another teacher’s class, and an invented one, alike', async () => {
    const booking = await pastClass();

    const strangers = await mark(other, booking.id, BOOKING_STATUS_CODES.COMPLETED).expect(404);
    const nothing = await mark(other, randomUUID(), BOOKING_STATUS_CODES.COMPLETED).expect(404);

    expect(nothing.body.message).toBe(strangers.body.message);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.CONFIRMED));
  });

  it('keeps the student’s door and the teacher’s door apart', async () => {
    const booking = await pastClass();

    await mark(undefined, booking.id, BOOKING_STATUS_CODES.COMPLETED).expect(401);
    const denied = await mark(member, booking.id, BOOKING_STATUS_CODES.COMPLETED).expect(403);

    expect(denied.body.code).toBe('FORBIDDEN');
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.CONFIRMED));
  });

  it('takes only the two words a mark can be', async () => {
    const booking = await pastClass();

    // Somebody else's verb for the same row: a student's cancellation is not a teacher's mark.
    for (const status of [
      BOOKING_STATUS_CODES.CANCELLED,
      BOOKING_STATUS_CODES.PENDING,
      'present',
      '',
    ]) {
      const res = await mark(teacher, booking.id, status).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.CONFIRMED));
  });

  it('files the mark in the ledger and mails nobody about it', async () => {
    const booking = await pastClass();
    const before = await prisma.mailOutbox.count({ where: { recipientUserId: memberId } });

    await marked(teacher, booking.id, BOOKING_STATUS_CODES.COMPLETED);

    // The four booking letters are news a person acts on. A mark reports a class that is already
    // over, and the student reads it on their own list — so the record is the whole report.
    expect(await prisma.mailOutbox.count({ where: { recipientUserId: memberId } })).toBe(before);
    expect(
      await prisma.actionLog.count({
        where: { targetId: booking.id, actionCode: ACTION_CODES.BOOKING_COMPLETED },
      }),
    ).toBe(1);
  });
});
