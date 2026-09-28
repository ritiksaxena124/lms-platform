import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The door of a live class: who may ask for the address, and when.
 *
 * Step 5d left the platform holding a room name it never sends. This file is the other half of
 * that decision — the one route allowed to turn the name into a URL and hand it over — and the
 * reason the two halves are separate is the reason these tests are mostly refusals: a Jitsi room
 * has no password and no expiry, so whoever holds the address holds the class, for as long as the
 * row lives. A list a browser caches, logs and prefetches is therefore no place for it, and this
 * endpoint is a POST for the same reason: a `GET` invites a prefetch, a history entry and a proxy
 * that keeps responses.
 *
 * So the questions here are, in order: is this one of the two accounts the class is about (the
 * student who booked it and the teacher who teaches it, and nobody else — not a stranger, and not
 * even another student enrolled in the same course); does the class stand; and is it *now*, inside
 * the same window the list published? The last is enforced server-side rather than left to the
 * screen's clock, because a portal that opened the door early would open it for everybody who
 * shares the room name.
 */
// Read before the module graph is built: `provideEnv()` runs inside `createTestApp`.
process.env.VIDEO_PROVIDER = 'jitsi';

const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

const TEACHER_ZONE = 'Asia/Kolkata';
/** The bridge `JITSI_DOMAIN` defaults to, so an address built from it is recognisable here. */
const BRIDGE = 'https://meet.jit.si/';
const MINUTE = 60_000;

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

/** A published course whose teacher keeps one class open every day at 09:00 IST. */
async function bookableCourse(
  app: INestApplication,
  teacher: string,
): Promise<{ id: string; slug: string }> {
  courseSequence += 1;
  const res = await request(serverOf(app))
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title: `Door drills ${courseSequence} ${RUN}`,
      slug: `join-course-${courseSequence}-${RUN}`,
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
): Promise<{ id: string; startsAt: string; durationMinutes: number }> {
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
  return res.body.booking as {
    id: string;
    startsAt: string;
    durationMinutes: number;
  };
}

async function confirm(
  app: INestApplication,
  teacher: string,
  bookingId: string,
): Promise<{ startsAt: string; endsAt: string }> {
  const res = await request(serverOf(app))
    .post(`/api/v1/bookings/${bookingId}/confirm`)
    .set('Authorization', `Bearer ${teacher}`)
    .expect(200);
  return res.body.booking as { startsAt: string; endsAt: string };
}

/**
 * Move a confirmed class in time, and its hold with it.
 *
 * There is no clock in this API to stub — services read `new Date()` the way everything else
 * does — and the window under test is measured against now, so the instant has to come to the
 * row. Both columns move together because they are the same claim written twice: a row that sat
 * on 09:00 and now sits at 14:00 still holding 09:00 would be a minute the grid offers again
 * while the unique index refuses it, which is a collision with no class behind it.
 */
async function moveStart(bookingId: string, startsAt: Date): Promise<void> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: { startsAt, slotHeldAt: startsAt },
  });
}

/** A class that is, server-time, happening right now: booked, agreed, and moved into its window.
 *
 * The grid only ever offers minutes that are still ahead, so an answer of `200` cannot be reached
 * by booking alone — the door would still be five minutes from opening. Every test that expects the
 * address asks for one of these instead of a plain confirmed class, which is the difference between
 * testing the door and testing the clock.
 */
async function classInSession(
  app: INestApplication,
  student: string,
  teacher: string,
  slug: string,
): Promise<{ id: string; startsAt: string; durationMinutes: number }> {
  const booking = await bookNext(app, student, slug);
  await confirm(app, teacher, booking.id);
  await moveStart(booking.id, new Date(Date.now() + 2 * MINUTE));
  return booking;
}

function room(app: INestApplication, token: string | undefined, bookingId: string): request.Test {
  const call = request(serverOf(app)).post(`/api/v1/bookings/${bookingId}/room`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function address(
  app: INestApplication,
  token: string,
  bookingId: string,
): Promise<{ url: string; cacheControl: string | undefined }> {
  const res = await room(app, token, bookingId).expect(200);
  return {
    url: (res.body.room as { url: string }).url,
    cacheControl: res.headers['cache-control'],
  };
}

/** The name on the row, which is the half of an address this platform owns. */
async function roomNameOf(bookingId: string): Promise<string | null> {
  const row = await prisma.booking.findFirstOrThrow({
    where: { id: bookingId },
    select: { roomName: true },
  });
  return row.roomName;
}

async function statusOf(bookingId: string): Promise<string> {
  return (
    await prisma.booking.findFirstOrThrow({
      where: { id: bookingId },
      select: { status: { select: { code: true } } },
    })
  ).status.code;
}

describe('the door of a live class', () => {
  let app: INestApplication;
  let teacher: string;
  let student: string;
  let classmate: string;
  let course: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register(app, 'jointr', 'teacher');
    student = await register(app, 'joinst', 'student');
    classmate = await register(app, 'joincm', 'student');
    await prisma.user.update({
      where: { id: await userIdFor('jointr') },
      data: { timezone: TEACHER_ZONE },
    });
    course = await bookableCourse(app, teacher);
    await enroll(app, student, course.id);
    // A second student with a place in the same course: the closest there is to being allowed in,
    // and the one account whose claim on this class is a real-looking "we teach the same thing".
    await enroll(app, classmate, course.id);
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

  it('refuses a request that has not been answered yet, and opens for the class once it has', async () => {
    const booking = await bookNext(app, student, course.slug);

    const tooEarly = await room(app, student, booking.id).expect(409);
    expect(tooEarly.body.code).toBe('CONFLICT');
    expect(await roomNameOf(booking.id)).toBeNull();

    await confirm(app, teacher, booking.id);
    const name = await roomNameOf(booking.id);
    expect(name).toBeTruthy();

    // The yes is what the first half of this test was missing, not the clock.
    await moveStart(booking.id, new Date(Date.now() + 2 * MINUTE));
    const asked = await address(app, student, booking.id);
    expect(asked.url).toBe(`${BRIDGE}${name}`);
  });

  it('keeps the address out of any cache, because it is the only lock the room has', async () => {
    const booking = await classInSession(app, student, teacher, course.slug);

    const asked = await address(app, student, booking.id);
    expect(asked.cacheControl).toContain('no-store');
  });

  it('hands the same address to the teacher whose class it is', async () => {
    const booking = await classInSession(app, student, teacher, course.slug);

    const theirs = await address(app, teacher, booking.id);
    expect(theirs.url).toBe(`${BRIDGE}${await roomNameOf(booking.id)}`);
  });

  it('answers the same way twice, because asking is not a write', async () => {
    const booking = await classInSession(app, student, teacher, course.slug);
    const first = await address(app, student, booking.id);
    const name = await roomNameOf(booking.id);

    expect((await address(app, student, booking.id)).url).toBe(first.url);
    // Nothing about the class moved: the room was minted by the confirmation and asking for its
    // address cannot mint a second one or retire the first.
    expect(await roomNameOf(booking.id)).toBe(name);
    expect(await statusOf(booking.id)).toBe('confirmed');
  });

  it('says nothing to an account that is not on the class, in the same words as one never written', async () => {
    // The class is open for the two people it is about, so what these three accounts are told has
    // to be about *them* rather than about a door that was shut anyway.
    const booking = await classInSession(app, student, teacher, course.slug);

    const stranger = await room(app, classmate, booking.id).expect(404);
    const invented = await room(app, classmate, randomUUID()).expect(404);

    expect(stranger.body.code).toBe('NOT_FOUND');
    expect(stranger.body.message).toBe(invented.body.message);
    // The teacher of a different course is also nobody here, which is the same rule pointed at
    // the role that otherwise owns the table.
    const otherTeacher = await register(app, 'joino1', 'teacher');
    await room(app, otherTeacher, booking.id).expect(404);
  });

  it('refuses an account that is not signed in at all', async () => {
    const booking = await bookNext(app, student, course.slug);
    await confirm(app, teacher, booking.id);

    await room(app, undefined, booking.id).expect(401);
  });

  it('opens the door five minutes before the first minute, and only then', async () => {
    const booking = await bookNext(app, student, course.slug);
    await confirm(app, teacher, booking.id);

    // Twenty minutes out: the window the list publishes has not begun, and a portal that asked
    // anyway gets the reason rather than the address.
    const startsAt = new Date(Date.now() + 20 * MINUTE);
    await moveStart(booking.id, startsAt);
    const shut = await room(app, student, booking.id).expect(409);
    expect(shut.body.code).toBe('CONFLICT');
    // The instant it names is the one the list would have shown, so a screen with a stale clock
    // still counts down to the same minute the server will unlock.
    expect(Date.parse(shut.body.details.opensAt)).toBe(startsAt.getTime() - 5 * MINUTE);

    // Three minutes out: inside the door, which is the point of the five.
    await moveStart(booking.id, new Date(Date.now() + 3 * MINUTE));
    expect((await address(app, student, booking.id)).url).toContain(BRIDGE);
  });

  it('shuts the door once the class and its grace have gone by', async () => {
    const booking = await bookNext(app, student, course.slug);
    await confirm(app, teacher, booking.id);

    // A class that started two hours ago ended, with its fifteen minutes of grace, almost an hour
    // back. The length came off the row, so this is the real arithmetic rather than a guess.
    await moveStart(booking.id, new Date(Date.now() - 120 * MINUTE));

    const over = await room(app, student, booking.id).expect(409);
    expect(over.body.code).toBe('CONFLICT');
    // The room still exists on the row — a class that was taught is not un-taught — it just has
    // nobody who may still be let in.
    expect(await roomNameOf(booking.id)).toBeTruthy();
  });

  it('keeps the door shut on a class the student gave up', async () => {
    const booking = await bookNext(app, student, course.slug);
    await confirm(app, teacher, booking.id);
    await moveStart(booking.id, new Date(Date.now() + 2 * MINUTE));
    expect((await address(app, student, booking.id)).url).toContain(BRIDGE);

    await request(serverOf(app))
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${student}`)
      .expect(200);

    const gone = await room(app, student, booking.id).expect(409);
    expect(gone.body.code).toBe('CONFLICT');
    await moveStart(booking.id, new Date(Date.now() + 2 * MINUTE));
    expect(await roomNameOf(booking.id)).toBeTruthy();
  });
});

describe('the door on a deployment with no live video', () => {
  let app: INestApplication;
  let teacher: string;
  let student: string;
  let course: { id: string; slug: string };

  beforeAll(async () => {
    process.env.VIDEO_PROVIDER = 'none';
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register(app, 'nonejo1', 'teacher');
    student = await register(app, 'nonejo2', 'student');
    await prisma.user.update({
      where: { id: await userIdFor('nonejo1') },
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

  it('refuses a room it never had, in words that do not blame the caller', async () => {
    const booking = await bookNext(app, student, course.slug);
    await confirm(app, teacher, booking.id);
    await moveStart(booking.id, new Date(Date.now() + 2 * MINUTE));

    const none = await room(app, student, booking.id).expect(409);
    expect(none.body.code).toBe('CONFLICT');
    expect(await roomNameOf(booking.id)).toBeNull();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
