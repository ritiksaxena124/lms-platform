import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BOOKING_STATUS_CODES, LKP_TYPE_CODES, PENDING_REQUEST_HOURS } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { BookingExpiryService } from '../src/modules/bookings/booking-expiry.service';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The sweep that ends a request a teacher never answered.
 *
 * A held minute with no decision on it is the worst state the booking table can be in: the teacher
 * has not said yes, the student has not got a class, and nobody else can take the time. Two things
 * end it — the teacher answers, or the request runs out — and this file is about the second.
 *
 * Two clocks expire a request, and both are needed because they answer different questions. A day
 * of silence is the teacher's answer in itself, whatever the class time; and a class whose minute
 * has arrived without a yes was never going to happen, however recently the student asked. A week
 * of nightly classes with no sweep would otherwise hold seven minutes nobody is using.
 *
 * The row survives in `expired` with its hold cleared, which is what makes the whole thing safe to
 * run twice: the sweep only ever looks at pending rows, so a second pass finds nothing to do, and
 * a run that overlaps itself cannot take back a minute some other request has just been given.
 *
 * Note that an expired *demo* still counts as the demo it was. The cap is about a student having
 * tried a teacher once, and a teacher's silence is not the student's second chance.
 *
 * ## Why the fixtures are made old rather than the clock moved forward
 *
 * Every sweep below runs at the moment it is actually standing in, and each test ages its own row
 * to be the stale thing the sweep then finds. The obvious alternative — sweep at `now + 25 hours`
 * and let the fixtures be young — is not available here, because a sweep is by nature global and a
 * future clock makes *every* pending row in the database overdue. These spec files share `lms_test`
 * and run in parallel, so a future clock would expire the requests another file is mid-flight with
 * and make two suites fail each other at random. Backdating a row says the same thing about one
 * booking and says nothing about anyone else's.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

const TEACHER_ZONE = 'Asia/Kolkata';
const MS_PER_HOUR = 60 * 60 * 1000;

interface Slot {
  startsAt: string;
  endsAt: string;
}

/** A class as this file needs it: which row, and when it was for. */
interface Booking {
  id: string;
  startsAt: string;
}

/** The two fields of a booked class this file acts on. */
interface Booking {
  id: string;
  startsAt: string;
}

let app: INestApplication;
const prisma = new PrismaClient();
let expiry: BookingExpiryService;
let scheduler: SchedulerRegistry;

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
  const slug = `sweep-course-${courseSequence}-${RUN}`;
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

async function slotsOf(token: string, course: string): Promise<Slot[]> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/bookings/slots')
    .query({ course })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.slots as Slot[];
}

/** The next class this teacher's calendar is offering, failing loudly if the grid came back empty
 * rather than letting a `undefined.startsAt` stand in for a missing horizon. */
async function nextSlot(token: string, course: string): Promise<Slot> {
  const [slot] = await slotsOf(token, course);
  if (!slot) throw new Error('The horizon came back empty.');
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

/** The sweep, at the moment it is really run. See the note at the top of this file. */
function sweep() {
  return expiry.expireStale(new Date());
}

/** Let the clock do its work on one row: the teacher has been silent for this long. */
async function waitingSince(id: string, hours: number) {
  await prisma.booking.update({
    where: { id },
    data: { createdAt: new Date(Date.now() - hours * MS_PER_HOUR) },
  });
}

/** Time passing for a class nobody confirmed: the minute it was for has arrived. */
async function startedAgo(id: string, hours: number) {
  const when = new Date(Date.now() - hours * MS_PER_HOUR);
  await prisma.booking.update({
    where: { id },
    data: { startsAt: when, slotHeldAt: when },
  });
}

const statusId = (code: string) =>
  prisma.lkpValue
    .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_STATUS } } })
    .then((row) => row.id);

async function rowOf(id: string) {
  return prisma.booking.findUniqueOrThrow({ where: { id } });
}

describe('the request nobody answered', () => {
  let teacher: string;
  let member: string;
  let trial: string;
  let course: { id: string; slug: string };
  let demoCourse: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    expiry = app.get(BookingExpiryService);
    scheduler = app.get(SchedulerRegistry);

    teacher = await register('sweetr', 'teacher');
    member = await register('sweemm', 'student');
    trial = await register('swettr', 'student');
    const teacherId = await userIdFor('sweetr');
    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });

    course = await createPublishedCourse(teacher);
    demoCourse = await createPublishedCourse(teacher, { demos: true });
    await openDailyWeek(teacher);
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
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('gives back a minute a day of silence has ended', async () => {
    const slot = await nextSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await waitingSince(booking.id, PENDING_REQUEST_HOURS + 1);

    const swept = await sweep();

    expect(swept).toBeGreaterThanOrEqual(1);
    const row = await rowOf(booking.id);
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.EXPIRED));
    expect(row.slotHeldAt).toBeNull();
    expect(row.isActive).toBe(true);
    expect(await slotsOf(member, course.id).then((list) => list[0]?.startsAt)).toBe(slot.startsAt);
  });

  it('ends a class whose minute has arrived, even on a request that is only an hour old', async () => {
    const slot = await nextSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await startedAgo(booking.id, 1);

    await sweep();

    const row = await rowOf(booking.id);
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.EXPIRED));
    expect(row.slotHeldAt).toBeNull();
  });

  it('leaves a request the teacher still has time to answer', async () => {
    const far = (await slotsOf(member, course.id)).at(-1);
    if (!far) throw new Error('The horizon came back empty.');
    const booking = await booked(member, course.id, far.startsAt);

    await sweep();

    const row = await rowOf(booking.id);
    expect(row.statusValueId).toBe(await statusId(BOOKING_STATUS_CODES.PENDING));
    expect(row.slotHeldAt?.toISOString()).toBe(far.startsAt);
  });

  it('has nothing to do the second time it runs', async () => {
    const slot = await nextSlot(member, course.id);
    const booking = await booked(member, course.id, slot.startsAt);
    await waitingSince(booking.id, PENDING_REQUEST_HOURS + 2);

    await sweep();
    const twice = await sweep();

    expect(twice).toBe(0);
    expect(await prisma.booking.count({ where: { id: booking.id } })).toBe(1);
  });

  it('does not touch a class the teacher answered, or one the student left', async () => {
    const [first, second] = await slotsOf(member, course.id);
    const confirmed = await booked(member, course.id, first!.startsAt);
    const cancelled = await booked(member, course.id, second!.startsAt);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${confirmed.id}/confirm`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${cancelled.id}/cancel`)
      .set('Authorization', `Bearer ${member}`)
      .expect(200);
    // Both are well past the window now, so the only thing that keeps them as they are is the
    // sweep's own rule about which statuses are still its business.
    await waitingSince(confirmed.id, PENDING_REQUEST_HOURS + 3);
    await waitingSince(cancelled.id, PENDING_REQUEST_HOURS + 3);

    await sweep();

    expect((await rowOf(confirmed.id)).statusValueId).toBe(
      await statusId(BOOKING_STATUS_CODES.CONFIRMED),
    );
    expect((await rowOf(cancelled.id)).statusValueId).toBe(
      await statusId(BOOKING_STATUS_CODES.CANCELLED),
    );
  });

  it('counts an unanswered demo as the demo it was', async () => {
    const slot = await nextSlot(trial, demoCourse.id);
    const booking = await booked(trial, demoCourse.id, slot.startsAt);
    await waitingSince(booking.id, PENDING_REQUEST_HOURS + 1);

    await sweep();

    expect((await rowOf(booking.id)).statusValueId).toBe(
      await statusId(BOOKING_STATUS_CODES.EXPIRED),
    );
    const calendar = await request(app.getHttpServer())
      .get('/api/v1/bookings/slots')
      .query({ course: demoCourse.id })
      .set('Authorization', `Bearer ${trial}`)
      .expect(200);
    expect(calendar.body.entitlement).toBe('none');
    expect(calendar.body.denial).toBe('demo_already_taken');
  });

  it('is on a clock as well as in this file', () => {
    // Nothing calls the sweep over HTTP, so a schedule that stopped being registered would leave
    // every test above green while held minutes went back to nobody. The name is spelled out here
    // rather than read from the service for the same reason: a renamed job is a job ops cannot
    // find, and a missing one has to fail loudly.
    const job = scheduler.getCronJob('booking-request-expiry');
    expect(job.isActive).toBe(true);
    expect(job.nextDate().toMillis() - Date.now()).toBeLessThanOrEqual(MS_PER_HOUR);
  });
});
