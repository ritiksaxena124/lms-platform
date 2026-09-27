import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BOOKING_STATUS_CODES } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The teacher's own calendar: the classes on their week, whoever is standing in them.
 *
 * `GET /bookings` answers for a student, and `GET /bookings/requests` answers only the rows still
 * waiting for an answer. Between those two sits the question this file is about — what am I
 * teaching? — and it is neither of them: it wants the answered rows alongside the waiting ones,
 * and it wants the name on each, because a teacher's six o'clock is somebody's lesson.
 *
 * So it is the student's list read from the other end of the same table, with the same rule about
 * what a list is: every standing row soonest-first, the screen deciding what "upcoming" means. A
 * teacher who called a class off is still looking at a class they called off, and a screen that
 * hid it would be editing the record to fit a tab.
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

interface Taught extends Booking {
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
  const slug = `taught-course-${courseSequence}-${RUN}`;
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

async function slotList(token: string, course: string): Promise<Slot[]> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.slots as Slot[];
}

/** The next minute nobody has asked for yet. A held minute leaves the grid, so a test that booked
 * the same slot twice would be asserting one class where it meant three. */
async function freeSlot(token: string, course: string): Promise<Slot> {
  const [slot] = await slotList(token, course);
  if (!slot) throw new Error('The horizon came back empty for a teacher with a daily window.');
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

function taught(token?: string): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/bookings/classes');
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function seenTaught(token: string): Promise<Taught[]> {
  const res = await taught(token).expect(200);
  return res.body.bookings as Taught[];
}

async function confirmedBy(token: string, id: string): Promise<Booking> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/bookings/${id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.booking as Booking;
}

describe('the teacher’s own class list', () => {
  let teacher: string;
  let other: string;
  let member: string;
  let course: { id: string; slug: string };
  let theirs: { id: string; slug: string };

  let confirmed: Booking;
  let waiting: Booking;
  let givenUp: Booking;

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('tahttr', 'teacher');
    other = await register('tahtot', 'teacher');
    member = await register('tahtmm', 'student');

    const teacherId = await userIdFor('tahttr');
    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });

    course = await createPublishedCourse(teacher);
    theirs = await createPublishedCourse(other);
    await openDailyWeek(teacher);
    await openDailyWeek(other);
    await enroll(member, course.id);
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

  it('carries the answered, the waiting and the given-up, in one date order', async () => {
    confirmed = await booked(member, course.id, (await freeSlot(member, course.id)).startsAt);
    await confirmedBy(teacher, confirmed.id);
    waiting = await booked(member, course.id, (await freeSlot(member, course.id)).startsAt);
    givenUp = await booked(member, course.id, (await freeSlot(member, course.id)).startsAt);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${givenUp.id}/cancel`)
      .set('Authorization', `Bearer ${member}`)
      .expect(200);

    const list = await seenTaught(teacher);
    const mine = list.filter((entry) => [confirmed.id, waiting.id, givenUp.id].includes(entry.id));

    expect(mine.map((entry) => entry.status).sort()).toEqual(
      [
        BOOKING_STATUS_CODES.CANCELLED,
        BOOKING_STATUS_CODES.CONFIRMED,
        BOOKING_STATUS_CODES.PENDING,
      ].sort(),
    );
    expect(list.map((entry) => new Date(entry.startsAt).getTime())).toEqual(
      [...list.map((entry) => new Date(entry.startsAt).getTime())].sort((a, b) => a - b),
    );
  });

  it('keeps another teacher’s classes off the list', async () => {
    const elsewhere = await booked(member, theirs.id, (await freeSlot(member, theirs.id)).startsAt);

    const list = await seenTaught(teacher);
    expect(list.some((entry) => entry.id === elsewhere.id)).toBe(false);
    expect((await seenTaught(other)).some((entry) => entry.id === elsewhere.id)).toBe(true);
  });

  it('names the person on the other side of each class', async () => {
    const list = await seenTaught(teacher);
    const [row] = list;
    if (!row) throw new Error('A teacher with three bookings came back with none.');

    expect(Object.keys(row).sort()).toEqual([
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
    expect(row.course).toMatchObject({ id: expect.any(String), title: expect.any(String) });
    expect(row.student).toEqual({ id: expect.any(String), displayName: 'tahtmm Person' });
  });

  it('is the teacher’s door only', async () => {
    await taught(member).expect(403);
    await taught().expect(401);
  });
});
