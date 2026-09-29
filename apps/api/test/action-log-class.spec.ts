import type { INestApplication } from '@nestjs/common';
import type { ActionLog } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACTION_SECTION_CODES,
  ACTION_TARGET_TABLE_CODES,
  BOOKING_STATUS_CODES,
  PENDING_REQUEST_HOURS,
} from '@lms/shared';

import { AppModule } from '../src/app.module';
import { BookingExpiryService } from '../src/modules/bookings/booking-expiry.service';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The class and place writes, each filing its own record.
 *
 * 7c-1 proved the rule on a teacher's syllabus, where every write has a person pressing it and a row
 * the same transaction edits. This file takes the two tables where that is not enough on its own:
 * a `booking` row changes hands between two accounts, and one of its five endings is reached by a
 * clock rather than by anybody. So the claims worth the file are that the record names the person who
 * actually pressed the button (a student's cancel is not a teacher's refusal, even though both end on
 * the same row), that a status move says which state it left rather than merely that it left one, and
 * that the sweep's work is filed as nobody's.
 *
 * Two rules from 7a carry through everything below. A row is earned by a write that changed
 * something — so a replayed press files nothing, and a press that was refused files nothing either,
 * which is the half of this the authoring file could only assert once. And `detail` holds the
 * decision rather than the content, so a transition names the two status codes it moved between and
 * never the class's time, the course's title, the person's name, or the room a confirmed class
 * happens to have.
 *
 * The sweep is called directly, at the moment it is really standing in, and each test ages its own
 * row rather than the clock — the reason that is the only safe shape is spelled out at the top of
 * `booking-expiry.spec.ts`, and it applies twice as hard here because this file reads what the sweep
 * left behind.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

interface Slot {
  startsAt: string;
  endsAt: string;
}

let app: INestApplication;
const prisma: PrismaClient = new PrismaClient();
let expiry: BookingExpiryService;

let teacherId = '';
let samId = '';

/** Sign in once per person and keep the token: `/auth/login` is throttled far below the requests a
 * file with two sides of a class in it would otherwise spend, and a suite that exhausted it would
 * report the throttle rather than the log. */
const tokens = new Map<string, string>();

async function bearer(name: string): Promise<string> {
  const cached = tokens.get(name);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  tokens.set(name, res.body.accessToken as string);
  return res.body.accessToken as string;
}

const filedBy = (requestId: string): Promise<ActionLog[]> =>
  prisma.actionLog.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });

/** Everything filed about one row. The sweep has no request to be found by, so a booking's own
 * history is the only way to read what it did — and `targetId` is indexed for exactly that. */
const rowsAbout = (targetId: string): Promise<ActionLog[]> =>
  prisma.actionLog.findMany({ where: { targetId }, orderBy: { createdAt: 'asc' } });

/** One press, and the rows it filed. */
async function press(
  who: string,
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: object,
): Promise<{ res: request.Response; rows: ActionLog[] }> {
  const token = await bearer(who);
  const server = app.getHttpServer();
  const url = `/api/v1${path}`;
  const call = request(server)[method](url).set('Authorization', `Bearer ${token}`);
  // `expect(fn)` hands the callback the whole Response, not the status, and fails only if the
  // callback throws — so the assertion has to be written as one.
  const res = await (body === undefined ? call : call.send(body)).expect((response) => {
    if (response.status < 200 || response.status > 299) {
      throw new Error(
        `${method.toUpperCase()} ${path} answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
  });
  return { res, rows: await filedBy(res.headers['x-request-id'] as string) };
}

/** A press that was refused, and the rows it filed — which is the claim, not the status: a write
 * that never happened has no record of it, and a log that recorded refusals would be a second copy
 * of the access log with the interesting half left out. */
async function refused(
  status: number,
  who: string,
  method: 'post' | 'patch',
  path: string,
  body?: object,
): Promise<ActionLog[]> {
  const token = await bearer(who);
  const server = app.getHttpServer();
  const url = `/api/v1${path}`;
  const call = request(server)[method](url).set('Authorization', `Bearer ${token}`);
  const res = await (body === undefined ? call : call.send(body)).expect(status);
  return filedBy(res.headers['x-request-id'] as string);
}

const shape = (row: ActionLog) => `${row.sectionCode}/${row.targetTable}/${row.actorKind}`;
const described = (rows: ActionLog[]) =>
  rows.map((row) => `${row.actionCode} ${JSON.stringify(row.detail)}`);

function onlyRow(rows: ActionLog[]): ActionLog {
  const [row] = rows;
  if (!row || rows.length !== 1) {
    throw new Error(`Expected exactly one record, got: ${JSON.stringify(rows)}`);
  }
  return row;
}

let courseSequence = 0;

/** A published course, which is the only kind a place can be taken in or a class asked for. */
async function createPublishedCourse(title: string): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${await bearer('carl')}`)
    .send({
      title: `${title} ${courseSequence} ${RUN}`,
      slug: `log-course-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'An hour of it, worked slowly.',
      description: 'Talk about films, food and travel, with corrections as we go.',
    })
    .expect(201);
  const id = res.body.course.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${await bearer('carl')}`)
    .expect(200);
  return id;
}

/** Every day of the teacher's week, 09:00 to 10:00, one class an hour long. */
async function openDailyWeek(): Promise<void> {
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await request(app.getHttpServer())
      .post('/api/v1/availability/rules')
      .set('Authorization', `Bearer ${await bearer('carl')}`)
      .send({ weekday, startMinutes: 540, endMinutes: 600, slotMinutes: 60 })
      .expect(201);
  }
}

async function slotsOf(who: string, course: string): Promise<Slot[]> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course })
    .set('Authorization', `Bearer ${await bearer(who)}`)
    .expect(200);
  return res.body.slots as Slot[];
}

/** The next class on offer, and the last one — the second is what a sweep test wants, because a
 * minute months away cannot arrive while the file is still running. */
async function nextSlot(who: string, course: string): Promise<Slot> {
  const [slot] = await slotsOf(who, course);
  if (!slot) throw new Error('The horizon came back empty.');
  return slot;
}

async function farSlot(who: string, course: string): Promise<Slot> {
  const slot = (await slotsOf(who, course)).at(-1);
  if (!slot) throw new Error('The horizon came back empty.');
  return slot;
}

async function bookedBy(
  who: string,
  course: string,
  startsAt: string,
): Promise<{ id: string; startsAt: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${await bearer(who)}`)
    .send({ course, startsAt })
    .expect(200);
  return res.body.booking as { id: string; startsAt: string };
}

/** Time passing for a request nobody answered: the teacher has been silent this long. */
async function waitingSince(bookingId: string, hours: number): Promise<void> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: { createdAt: new Date(Date.now() - hours * MS_PER_HOUR) },
  });
}

async function expiredRowsFor(bookingId: string): Promise<ActionLog[]> {
  return (await rowsAbout(bookingId)).filter((row) => row.actionCode === 'booking_expired');
}

beforeAll(async () => {
  await seedLookups(prisma);
  app = await createTestApp({ imports: [AppModule] });
  expiry = app.get(BookingExpiryService);

  for (const [name, role] of [
    ['carl', 'teacher'],
    ['sam', 'student'],
    ['nina', 'student'],
  ] as const) {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
      .expect(201);
    await bearer(name);
  }

  teacherId = (await prisma.user.findFirstOrThrow({ where: { email: emailFor('carl') } })).id;
  samId = (await prisma.user.findFirstOrThrow({ where: { email: emailFor('sam') } })).id;
  await prisma.user.update({ where: { id: teacherId }, data: { timezone: 'Asia/Kolkata' } });
  // The week every class in this file is chosen from: one hour a day, seven days, so a month of
  // horizon has more minutes in it than the file can book.
  await openDailyWeek();
});

afterAll(async () => {
  await app?.close();

  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((user) => user.id);
  const courseIds = (
    await prisma.course.findMany({
      where: { teacherUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((course) => course.id);
  const bookingIds = (
    await prisma.booking.findMany({
      where: { OR: [{ studentUserId: { in: userIds } }, { teacherUserId: { in: userIds } }] },
      select: { id: true },
    })
  ).map((booking) => booking.id);
  const enrollmentIds = (
    await prisma.enrollment.findMany({
      where: { studentUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((place) => place.id);

  // Children before parents, and the record of a write first of all. The sweep's rows name no
  // account, so clearing the log by its actor would leave them behind — they are found by the row
  // they were about instead, which is the only thing that ties them to this file.
  await prisma.actionLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: [...bookingIds, ...enrollmentIds, ...courseIds] } },
      ],
    },
  });
  await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.enrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
  await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: userIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("a place in somebody's course", () => {
  it('files the join and the leave, each as the one write they were', async () => {
    // Each test here takes its own course. The four claims are a sequence of presses on the same
    // place — held, replayed, left, reopened — and a sequence split across tests would make each
    // one's starting state whatever the previous test happened to leave.
    const course = await createPublishedCourse('Conversation club');

    const joined = await press('sam', 'post', '/enrollments', { courseId: course });
    const place = joined.res.body.enrollment as { id: string };

    const row = onlyRow(joined.rows);
    expect(row).toMatchObject({
      actionCode: 'enrollment_joined',
      sectionCode: ACTION_SECTION_CODES.ENROLLMENT,
      targetTable: ACTION_TARGET_TABLE_CODES.ENROLLMENT,
      targetId: place.id,
      actorKind: 'user',
      actorUserId: samId,
      actorRoleCode: 'student',
      requestId: joined.res.headers['x-request-id'],
    });
    expect(shape(row)).toBe('enrollment/enrollment/user');
    // A place that was never there: the only thing this write decided is that it is there now, and
    // the row it wrote already says whose, in which course, and since when.
    expect(row.detail).toEqual({ reopened: false });

    const left = await press('sam', 'post', `/enrollments/${place.id}/cancel`);

    expect(described(left.rows)).toEqual(['enrollment_left {}']);
    expect(onlyRow(left.rows)).toMatchObject({
      targetId: place.id,
      actorUserId: samId,
      actorRoleCode: 'student',
    });
  });

  it('files nothing for a place the student already holds, or one already left', async () => {
    const course = await createPublishedCourse('Conversation club');
    const held = await press('sam', 'post', '/enrollments', { courseId: course });
    const place = held.res.body.enrollment as { id: string };
    expect(onlyRow(held.rows).detail).toEqual({ reopened: false });

    // The second press is the same button, and the row already says yes: nothing was written, so
    // there is nothing to file.
    expect(await press('sam', 'post', '/enrollments', { courseId: course })).toMatchObject({
      rows: [],
    });

    const left = await press('sam', 'post', `/enrollments/${place.id}/cancel`);
    expect(described(left.rows)).toEqual(['enrollment_left {}']);

    // Leaving twice tells the student they left once.
    expect(await press('sam', 'post', `/enrollments/${place.id}/cancel`)).toMatchObject({
      rows: [],
    });
  });

  it('says a reopened place is a reopened place', async () => {
    const course = await createPublishedCourse('Grammar clinic');
    const joined = await press('sam', 'post', '/enrollments', { courseId: course });
    const place = joined.res.body.enrollment as { id: string };
    await press('sam', 'post', `/enrollments/${place.id}/cancel`);

    const rejoined = await press('sam', 'post', '/enrollments', { courseId: course });

    const row = onlyRow(rejoined.rows);
    expect(row.actionCode).toBe('enrollment_joined');
    // This press did not open a new place — it reopened the row that was always there. An operator
    // counting new students reads that difference off this key rather than off the day the row was
    // created, which the reopen deliberately left alone.
    expect(row.detail).toEqual({ reopened: true });
    expect(row.targetId).toBe(place.id);
  });

  it('files a place that could not be taken as nothing at all', async () => {
    expect(await refused(404, 'nina', 'post', '/enrollments', { courseId: randomUUID() })).toEqual(
      [],
    );
  });
});

describe('a class a student asks for', () => {
  let course = '';

  beforeAll(async () => {
    course = await createPublishedCourse('Film club');
    await press('sam', 'post', '/enrollments', { courseId: course });
  });

  it('files the request, and nobody but the student who pressed it', async () => {
    const slot = await nextSlot('sam', course);
    const asked = await press('sam', 'post', '/bookings', { course, startsAt: slot.startsAt });
    const booking = asked.res.body.booking as { id: string };

    const row = onlyRow(asked.rows);
    expect(row).toMatchObject({
      actionCode: 'booking_requested',
      sectionCode: ACTION_SECTION_CODES.BOOKING,
      targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
      targetId: booking.id,
      actorKind: 'user',
      actorUserId: samId,
      actorRoleCode: 'student',
    });
    expect(shape(row)).toBe('booking/booking/user');
    // The kind of booking, the minute, the length and the hold are all columns the insert wrote.
    expect(row.detail).toEqual({});

    // The same press by the same student is the same request replayed, and a teacher told twice
    // about one ask stops believing the second letter.
    expect(
      await press('sam', 'post', '/bookings', { course, startsAt: slot.startsAt }),
    ).toMatchObject({ rows: [] });
  });

  it('files nothing for a minute nobody keeps open, or for a student with no right to ask', async () => {
    const slot = await nextSlot('sam', course);
    const notAClass = new Date(Date.parse(slot.startsAt) + 15 * MS_PER_MINUTE).toISOString();
    expect(await refused(400, 'sam', 'post', '/bookings', { course, startsAt: notAClass })).toEqual(
      [],
    );

    // Nina holds no place in this course and its teacher has not opened it to demo calls, so the
    // write is refused on the entitlement rather than on the minute — and refused either way.
    expect(
      await refused(409, 'nina', 'post', '/bookings', { course, startsAt: slot.startsAt }),
    ).toEqual([]);
  });

  it("files the teacher's yes as the move it was, and the same yes twice as once", async () => {
    const slot = await nextSlot('sam', course);
    const booking = await bookedBy('sam', course, slot.startsAt);

    const confirmed = await press('carl', 'post', `/bookings/${booking.id}/confirm`);
    const row = onlyRow(confirmed.rows);
    expect(row).toMatchObject({
      actionCode: 'booking_confirmed',
      targetId: booking.id,
      actorUserId: teacherId,
      actorRoleCode: 'teacher',
    });
    expect(row.detail).toEqual({
      from: BOOKING_STATUS_CODES.PENDING,
      to: BOOKING_STATUS_CODES.CONFIRMED,
    });

    expect(await press('carl', 'post', `/bookings/${booking.id}/confirm`)).toMatchObject({
      rows: [],
    });
  });

  it("files the teacher's no", async () => {
    const slot = await nextSlot('sam', course);
    const booking = await bookedBy('sam', course, slot.startsAt);

    const refusedAnswer = await press('carl', 'post', `/bookings/${booking.id}/reject`);

    const row = onlyRow(refusedAnswer.rows);
    expect(row.actionCode).toBe('booking_refused');
    // Read as an object, not as serialized text: Postgres reorders `jsonb` keys by value length, so
    // a two-key detail does not come back in the order it went in.
    expect(row.detail).toEqual({
      from: BOOKING_STATUS_CODES.PENDING,
      to: BOOKING_STATUS_CODES.REJECTED,
    });
  });

  it('files a cancel from whichever state the class was standing in', async () => {
    const [first, second] = await slotsOf('sam', course);
    const asked = await bookedBy('sam', course, first!.startsAt);
    const taught = await bookedBy('sam', course, second!.startsAt);
    await press('carl', 'post', `/bookings/${taught.id}/confirm`);

    const withdrawn = await press('sam', 'post', `/bookings/${asked.id}/cancel`);
    const givenUp = await press('sam', 'post', `/bookings/${taught.id}/cancel`);

    // Two different decisions wearing one action code: a student taking back an ask is not a
    // student walking out of a class they were told yes to. The state the row was in is read inside
    // the write rather than assumed by the route, which is what makes `from` an answer.
    expect(onlyRow(withdrawn.rows).detail).toEqual({
      from: BOOKING_STATUS_CODES.PENDING,
      to: BOOKING_STATUS_CODES.CANCELLED,
    });
    expect(onlyRow(givenUp.rows).detail).toEqual({
      from: BOOKING_STATUS_CODES.CONFIRMED,
      to: BOOKING_STATUS_CODES.CANCELLED,
    });

    // A second press is the same answer given again — which is why the reply is not an error and
    // the record is not a second row.
    expect(await press('sam', 'post', `/bookings/${asked.id}/cancel`)).toMatchObject({ rows: [] });
  });

  it('files a cancel of a class the teacher had already said no to as a conflict, and nothing else', async () => {
    const slot = await nextSlot('sam', course);
    const booking = await bookedBy('sam', course, slot.startsAt);
    await press('carl', 'post', `/bookings/${booking.id}/reject`);

    // A refused class is not standing, so there is nothing left for the student to give back. The
    // two records this booking has are the ask and the no; a third row would say the student ended
    // a class the teacher had already ended.
    expect(await refused(409, 'sam', 'post', `/bookings/${booking.id}/cancel`)).toEqual([]);
    expect((await rowsAbout(booking.id)).map((row) => row.actionCode)).toEqual([
      'booking_requested',
      'booking_refused',
    ]);
  });

  it('keeps the room, the address and the name out of the record', async () => {
    const slot = await nextSlot('sam', course);
    const booking = await bookedBy('sam', course, slot.startsAt);
    await press('carl', 'post', `/bookings/${booking.id}/confirm`);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const written = JSON.stringify(await rowsAbout(booking.id));

    // §10: a room name is the lock on a bridge with no password, and an address is somebody's. Both
    // are reachable from the booking row this record names, so neither belongs in the log — and a
    // `none` deployment never minted one to leak, which is why the first half is conditional.
    if (row.roomName) expect(written).not.toContain(row.roomName);
    expect(written).not.toMatch(/https?:/);
    expect(written).not.toContain(emailFor('sam'));
    expect(written).not.toContain('sam Person');
  });

  it('files a cancel of a class that was never there as nothing', async () => {
    expect(await refused(404, 'nina', 'post', `/bookings/${randomUUID()}/cancel`)).toEqual([]);
  });
});

describe('the sweep that ends an unanswered request', () => {
  let course = '';

  beforeAll(async () => {
    course = await createPublishedCourse('Reading circle');
    await press('sam', 'post', '/enrollments', { courseId: course });
  });

  it("files the expiry as nobody's action", async () => {
    const slot = await farSlot('sam', course);
    const booking = await bookedBy('sam', course, slot.startsAt);
    await waitingSince(booking.id, PENDING_REQUEST_HOURS + 1);

    await expiry.expireStale(new Date());

    const [row] = await expiredRowsFor(booking.id);
    if (!row) throw new Error(`The sweep filed nothing about ${booking.id}`);
    expect(row).toMatchObject({
      actionCode: 'booking_expired',
      sectionCode: ACTION_SECTION_CODES.BOOKING,
      targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
      targetId: booking.id,
      actorKind: 'system',
      actorUserId: null,
      actorRoleCode: null,
      // No request pressed this button, so there is no request id to link it to. A row that carried
      // the id of whoever happened to be waiting would credit their visit with the sweep's work.
      requestId: null,
    });
    expect(shape(row)).toBe('booking/booking/system');
    expect(row.detail).toEqual({
      from: BOOKING_STATUS_CODES.PENDING,
      to: BOOKING_STATUS_CODES.EXPIRED,
    });
  });

  it('files nothing for a request it had no reason to end', async () => {
    const slot = await farSlot('sam', course);
    const booking = await bookedBy('sam', course, slot.startsAt);

    await expiry.expireStale(new Date());

    const rows = await expiredRowsFor(booking.id);
    expect(rows).toEqual([]);
    // The ask is still the only record this booking has.
    expect(described(await rowsAbout(booking.id))).toEqual(['booking_requested {}']);
  });
});
