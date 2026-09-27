import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BOOKING_STATUS_CODES, LKP_TYPE_CODES } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The teacher's side of the same table: the requests waiting for an answer, and the answer.
 *
 * A student's press only books a *minute*; a class exists when the teacher says so. That gap is
 * the whole subject of this file, and it is why the list carries a name — a teacher deciding
 * whether they can teach someone on Thursday evening is deciding about a person, not about a uuid.
 *
 * Three rules hold it together.
 *
 * An answer only travels one way. A request is pending, and the teacher moves it to confirmed or
 * rejected; anything already answered — including the student having left in the meantime — comes
 * back as a conflict rather than being quietly rewritten, because an answer that overwrote another
 * answer would be the teacher mis-remembering their own week.
 *
 * Confirming keeps the minute held and refusing gives it back. Those are the two halves of the
 * hold: it exists so a request cannot be accepted by two people at once, and it has no reason to
 * survive a no.
 *
 * And a class belongs to its teacher the way a course belongs to its author, so somebody else's
 * request is answered with the same `NOT_FOUND` an invented id gets.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

const TEACHER_ZONE = 'Asia/Kolkata';

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

interface RequestItem extends Booking {
  student: { id: string; displayName: string };
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
  const slug = `answer-course-${courseSequence}-${RUN}`;
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

async function slotList(token: string, course: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
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

function requests(token: string): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/bookings/requests');
  return call.set('Authorization', `Bearer ${token}`);
}

async function seenRequests(token: string): Promise<RequestItem[]> {
  const res = await requests(token).expect(200);
  return res.body.requests as RequestItem[];
}

function answer(token: string | undefined, verb: 'confirm' | 'reject', id: string): request.Test {
  const call = request(app.getHttpServer()).post(`/api/v1/bookings/${id}/${verb}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function answered(token: string, verb: 'confirm' | 'reject', id: string): Promise<Booking> {
  const res = await answer(token, verb, id).expect(200);
  return res.body.booking as Booking;
}

const statusId = (code: string) =>
  prisma.lkpValue
    .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_STATUS } } })
    .then((row) => row.id);

describe('answering a request', () => {
  let teacher: string;
  let other: string;
  let member: string;
  let member2: string;
  let course: { id: string; slug: string };
  let theirs: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('answtr', 'teacher');
    other = await register('answot', 'teacher');
    member = await register('answmm', 'student');
    member2 = await register('answm2', 'student');

    const teacherId = await userIdFor('answtr');
    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });

    course = await createPublishedCourse(teacher);
    theirs = await createPublishedCourse(other);
    await openDailyWeek(teacher);
    await openDailyWeek(other);
    await enroll(member, course.id);
    await enroll(member2, course.id);
    // A request on somebody else's calendar, so the list can be shown to hold only this teacher's
    // own. Two teachers sharing a table is the only way to ask that question of a query.
    await enroll(member, theirs.id);
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

  it('shows a teacher the requests waiting on them, with the name attached', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);

    const list = await seenRequests(teacher);
    const mine = list.filter((entry) => entry.id === booking.id);

    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      status: BOOKING_STATUS_CODES.PENDING,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      durationMinutes: 60,
      course: { id: course.id, slug: course.slug },
      student: { displayName: 'answmm Person' },
    });
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual([
      'course',
      'createdAt',
      'durationMinutes',
      'endsAt',
      'id',
      'live',
      'startsAt',
      'status',
      'student',
      'type',
      'updatedAt',
    ]);
    // Soonest first, so the next thing to answer is at the top of the screen rather than the last
    // request that happened to arrive.
    const starts = list.map((entry) => new Date(entry.startsAt).getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('keeps another teacher’s requests off the list', async () => {
    const slot = await firstSlot(member, theirs.id);
    const foreign = await booked(member, theirs.id, slot.startsAt);

    const list = await seenRequests(teacher);

    expect(list.some((entry) => entry.id === foreign.id)).toBe(false);
    expect((await seenRequests(other)).some((entry) => entry.id === foreign.id)).toBe(true);
  });

  it('confirms a class, and keeps its minute held', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);

    const confirmed = await answered(teacher, 'confirm', booking.id);

    expect(confirmed.status).toBe(BOOKING_STATUS_CODES.CONFIRMED);
    expect(confirmed.startsAt).toBe(slot.startsAt);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.slotHeldAt?.toISOString()).toBe(slot.startsAt);
    // The grid no longer offers it either way: once to the student who asked before, and once
    // because a confirmed class is not free.
    expect(await slotList(member2, course.id)).not.toContain(slot.startsAt);
  });

  it('refuses a class and hands the minute back', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);

    const rejected = await answered(teacher, 'reject', booking.id);

    expect(rejected.status).toBe(BOOKING_STATUS_CODES.REJECTED);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.slotHeldAt).toBeNull();
    expect(row.isActive).toBe(true);
    expect(await slotList(member2, course.id)).toContain(slot.startsAt);
    expect((await seenRequests(teacher)).some((entry) => entry.id === booking.id)).toBe(false);
  });

  it('answers a second confirm with the same confirmed class', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await answered(teacher, 'confirm', booking.id);

    const twice = await answered(teacher, 'confirm', booking.id);

    expect(twice.id).toBe(booking.id);
    expect(twice.status).toBe(BOOKING_STATUS_CODES.CONFIRMED);
    expect(await prisma.booking.count({ where: { id: booking.id } })).toBe(1);
  });

  it('will not take back an answer it already gave', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await answered(teacher, 'confirm', booking.id);

    const flip = await answer(teacher, 'reject', booking.id).expect(409);

    expect(flip.body.code).toBe('CONFLICT');
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.CONFIRMED));
    expect(row.slotHeldAt?.toISOString()).toBe(slot.startsAt);
  });

  it('will not answer a class the student already left', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${member}`)
      .expect(200);

    const res = await answer(teacher, 'confirm', booking.id).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.CANCELLED));
  });

  it('refuses another teacher’s request, and an invented one, alike', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);

    const strangers = await answer(other, 'confirm', booking.id).expect(404);
    const nothing = await answer(other, 'confirm', randomUUID()).expect(404);

    expect(nothing.body.message).toBe(strangers.body.message);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.PENDING));
  });

  it('keeps the student’s door and the teacher’s door apart', async () => {
    const slot = await firstSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);

    await requests(member).expect(403);
    await answer(undefined, 'confirm', booking.id).expect(401);
    await answer(member, 'confirm', booking.id).expect(403);
    await answer(member, 'reject', booking.id).expect(403);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.PENDING));
  });
});
