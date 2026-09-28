import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The room a live class happens in — when it appears, and what a portal is allowed to see of it.
 *
 * A booking becomes a class when the teacher confirms it, and that is the moment this platform
 * decides a room exists: before it, a request that gets refused or left to expire would have taken
 * an address for a class nobody taught. Two things about a Jitsi room make the rest of these
 * specs the security review rather than the feature review (ARCHITECTURE §6): it has no password,
 * so the name is the only lock; and it has no expiry, so a name that leaked would open the class
 * for as long as the row lives.
 *
 * So: the name is minted from a uuid, never from anything a person could guess; it is stored and
 * never sent — a list carries the *window* the door stands open in, and the address itself is the
 * join endpoint's to hand out, one person at a time; and on a deployment with `VIDEO_PROVIDER=none`
 * there is nothing to mint, which has to be a real answer rather than a broken one.
 */
// Read before the module graph is built: `provideEnv()` runs inside `createTestApp`, so a
// provider chosen afterwards would still be the ambient one.
process.env.VIDEO_PROVIDER = 'jitsi';

const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

const TEACHER_ZONE = 'Asia/Kolkata';
const MINUTE = 60_000;

interface BookingWire {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  live: { opensAt: string; closesAt: string } | null;
}

const prisma = new PrismaClient();

function serverOf(app: INestApplication) {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

async function register(app: INestApplication, name: string, role: string): Promise<string> {
  await request(serverOf(app))
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
    .expect(201);
  const res = await request(serverOf(app))
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

async function userIdFor(name: string): Promise<string> {
  return (await prisma.user.findFirstOrThrow({ where: { email: emailFor(name) } })).id;
}

let courseSequence = 0;

async function bookableCourse(
  app: INestApplication,
  teacher: string,
): Promise<{ id: string; slug: string }> {
  courseSequence += 1;
  const res = await request(serverOf(app))
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title: `Piano hours ${courseSequence} ${RUN}`,
      slug: `room-course-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'One hour at the bench.',
      description: 'Scales, then a piece, then scales again.',
    })
    .expect(201);
  const id = res.body.course.id as string;
  await request(serverOf(app))
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${teacher}`)
    .expect(200);
  // The teacher keeps one class a day at 09:00, so the grid has a minute to offer.
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await request(serverOf(app))
      .post('/api/v1/availability/rules')
      .set('Authorization', `Bearer ${teacher}`)
      .send({ weekday, startMinutes: 540, endMinutes: 600, slotMinutes: 60 })
      .expect(201);
  }
  return { id, slug: res.body.course.slug as string };
}

async function enroll(app: INestApplication, student: string, courseId: string) {
  await request(serverOf(app))
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${student}`)
    .send({ courseId })
    .expect(200);
}

async function bookNext(
  app: INestApplication,
  student: string,
  slug: string,
): Promise<BookingWire> {
  const slots = await request(serverOf(app))
    .get('/api/v1/bookings/slots')
    .query({ course: slug })
    .set('Authorization', `Bearer ${student}`)
    .expect(200);
  const slot = (slots.body.slots as { startsAt: string }[])[0];
  if (!slot) throw new Error('The teacher kept no open minute.');
  const res = await request(serverOf(app))
    .post('/api/v1/bookings')
    .set('Authorization', `Bearer ${student}`)
    .send({ course: slug, startsAt: slot.startsAt })
    .expect(200);
  return res.body.booking as BookingWire;
}

async function press(
  app: INestApplication,
  token: string,
  verb: 'confirm' | 'reject',
  id: string,
): Promise<BookingWire> {
  const res = await request(serverOf(app))
    .post(`/api/v1/bookings/${id}/${verb}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.booking as BookingWire;
}

async function cancel(app: INestApplication, student: string, id: string): Promise<BookingWire> {
  const res = await request(serverOf(app))
    .post(`/api/v1/bookings/${id}/cancel`)
    .set('Authorization', `Bearer ${student}`)
    .expect(200);
  return res.body.booking as BookingWire;
}

/** The name on the row, which is the only place the answer lives. `undefined` from Prisma would
 * mean the column is not there; `null` means it is, and nothing minted it. */
async function roomNameOf(bookingId: string): Promise<string | null> {
  const row = await prisma.booking.findFirstOrThrow({
    where: { id: bookingId },
    select: { roomName: true },
  });
  return row.roomName;
}

function minutesBeforeDoorOpens(booking: BookingWire): number {
  if (!booking.live) throw new Error('The class came back with no door.');
  return (Date.parse(booking.startsAt) - Date.parse(booking.live.opensAt)) / MINUTE;
}

function minutesAfterDoorCloses(booking: BookingWire): number {
  if (!booking.live) throw new Error('The class came back with no door.');
  return (Date.parse(booking.live.closesAt) - Date.parse(booking.endsAt)) / MINUTE;
}

describe('a confirmed class and the room it happens in', () => {
  let app: INestApplication;
  let teacher: string;
  let student: string;
  let course: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register(app, 'roomtr', 'teacher');
    student = await register(app, 'roomst', 'student');
    await prisma.user.update({
      where: { id: await userIdFor('roomtr') },
      data: { timezone: TEACHER_ZONE },
    });
    course = await bookableCourse(app, teacher);
    await enroll(app, student, course.id);
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } } })
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
  });

  it('asks a Jitsi-backed app for a room and gets one at the moment the teacher says yes', async () => {
    const requestRow = await bookNext(app, student, course.slug);
    expect(requestRow.live).toBeNull();
    expect(await roomNameOf(requestRow.id)).toBeNull();

    const confirmed = await press(app, teacher, 'confirm', requestRow.id);
    expect(confirmed.status).toBe('confirmed');

    const name = await roomNameOf(confirmed.id);
    expect(name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('tells both calendars when the door stands open', async () => {
    const confirmed = await press(
      app,
      teacher,
      'confirm',
      await bookNext(app, student, course.slug).then((row) => row.id),
    );

    // The window is the pair of numbers the shared schedule already owns — five minutes early to
    // let the teacher settle, fifteen late so a slow leaver is not locked out. Read here rather
    // than computed by each portal, because a screen that opens the room at its own time is a
    // student sitting outside a door the server already shut.
    expect(minutesBeforeDoorOpens(confirmed)).toBe(5);
    expect(minutesAfterDoorCloses(confirmed)).toBe(15);

    const mine = await request(serverOf(app))
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${student}`)
      .expect(200);
    const listed = (mine.body.bookings as BookingWire[]).find((row) => row.id === confirmed.id);
    expect(listed?.live).toEqual(confirmed.live);

    const theirs = await request(serverOf(app))
      .get('/api/v1/bookings/classes')
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    const teacherRow = (theirs.body.bookings as BookingWire[]).find(
      (row) => row.id === confirmed.id,
    );
    expect(teacherRow?.live).toEqual(confirmed.live);
  });

  it('keeps the address off every list, because the name is the only lock on the room', async () => {
    const booking = await bookNext(app, student, course.slug);
    const confirmed = await press(app, teacher, 'confirm', booking.id);
    const name = await roomNameOf(confirmed.id);
    expect(name).toBeTruthy();

    const lists = await Promise.all([
      request(serverOf(app)).get('/api/v1/bookings').set('Authorization', `Bearer ${student}`),
      request(serverOf(app))
        .get('/api/v1/bookings/classes')
        .set('Authorization', `Bearer ${teacher}`),
      request(serverOf(app))
        .get('/api/v1/bookings/requests')
        .set('Authorization', `Bearer ${teacher}`),
      request(serverOf(app))
        .post(`/api/v1/bookings/${confirmed.id}/confirm`)
        .set('Authorization', `Bearer ${teacher}`),
    ]);

    for (const res of lists) {
      const wire = JSON.stringify(res.body);
      expect(wire).not.toContain(name as string);
      expect(wire).not.toContain('meet.jit.si');
      expect(wire).not.toContain('https://');
    }
  });

  it('mints once: answering the same request again keeps the room it already had', async () => {
    const booking = await bookNext(app, student, course.slug);
    const first = await press(app, teacher, 'confirm', booking.id);
    const name = await roomNameOf(first.id);

    const again = await press(app, teacher, 'confirm', booking.id);
    expect(again.live).toEqual(first.live);
    expect(await roomNameOf(booking.id)).toBe(name);
  });

  it('gives no room to a request the teacher refused', async () => {
    const booking = await bookNext(app, student, course.slug);
    const refused = await press(app, teacher, 'reject', booking.id);

    expect(refused.status).toBe('rejected');
    expect(refused.live).toBeNull();
    expect(await roomNameOf(booking.id)).toBeNull();
  });

  it('closes the door on a cancelled class without erasing what it was', async () => {
    const booking = await bookNext(app, student, course.slug);
    await press(app, teacher, 'confirm', booking.id);
    const name = await roomNameOf(booking.id);

    const cancelled = await cancel(app, student, booking.id);
    expect(cancelled.status).toBe('cancelled');
    // No window for a class that no longer stands, whatever the row still remembers: the minute
    // is back on the teacher's calendar and the person who might join is nobody.
    expect(cancelled.live).toBeNull();
    // The name survives on the history, because a booking row is never rewritten to forget what
    // happened — and it stays harmless, since nothing hands the address out to a cancelled class.
    expect(await roomNameOf(booking.id)).toBe(name);
  });

  it('offers the same minute a cancelled class released, and the new class gets its own room', async () => {
    const booking = await bookNext(app, student, course.slug);
    await press(app, teacher, 'confirm', booking.id);
    await cancel(app, student, booking.id);
    const oldName = await roomNameOf(booking.id);

    const replacement = await bookNext(app, student, course.slug);
    expect(replacement.startsAt).toBe(booking.startsAt);
    await press(app, teacher, 'confirm', replacement.id);

    // Two classes, two rooms: a student rebooking the minute they gave up must not be sent to the
    // room their own last attempt was in, and the teacher must not find a stranger there.
    expect(await roomNameOf(replacement.id)).not.toBe(oldName);
  });
});

describe('a deployment with no live video', () => {
  let app: INestApplication;
  let teacher: string;
  let student: string;
  let course: { id: string; slug: string };

  beforeAll(async () => {
    // The same code, the other value the enum allows: `none` is an adapter, so a school that has
    // not decided about video still books, confirms and cancels classes — it just has no rooms.
    process.env.VIDEO_PROVIDER = 'none';
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register(app, 'norotrk', 'teacher');
    student = await register(app, 'norost', 'student');
    await prisma.user.update({
      where: { id: await userIdFor('norotrk') },
      data: { timezone: TEACHER_ZONE },
    });
    course = await bookableCourse(app, teacher);
    await enroll(app, student, course.id);
  });

  afterAll(async () => {
    process.env.VIDEO_PROVIDER = 'jitsi';
    await app?.close();
    const userIds = (
      await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } } })
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
  });

  it('confirms a class without a room, and says so by giving no door', async () => {
    const booking = await bookNext(app, student, course.slug);
    const confirmed = await press(app, teacher, 'confirm', booking.id);

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.live).toBeNull();
    expect(await roomNameOf(confirmed.id)).toBeNull();
  });
});

afterAll(async () => {
  // One client for the whole file, and both of its apps are finished with it by now.
  await prisma.$disconnect();
});
