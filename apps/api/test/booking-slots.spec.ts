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
 * The grid a student is offered: a course's open class times.
 *
 * `booking-schema.spec.ts` showed that the table decides nothing about who may book or which
 * statuses hold a minute. This is where those decisions live, and four of them shape every answer
 * below.
 *
 * The grid is derived, never stored. A teacher's windows are a rule about their wall clock, so
 * what is offered is that rule expanded across the coming horizon in the *teacher's* zone and then
 * cut down by two facts: a minute already held, and a minute already gone by. A student is
 * therefore never shown a class they could not book, and a teacher changing a window needs no
 * repair job in a table.
 *
 * The entitlement decides which grid a caller sees at all. A place in the course opens the whole
 * calendar; a student without one sees a demo calendar only if the teacher opened that course to
 * demos, and only until they have taken their single demo — cancelled or not, because the cap is
 * about a person having tried the teacher once, not about a slot still standing.
 *
 * And when neither applies, the answer is empty with a reason rather than a `403`: the screen has
 * to say something different for "enroll first" than for "you already used your trial call", and
 * a status code would push the student's own history into an error path.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

/** The teacher keeps every day of their week open for one 09:00 class. A zone with no DST and a
 * daily window make the horizon countable: exactly one class per day, thirty days deep. */
const TEACHER_ZONE = 'Asia/Kolkata';
const DAILY_0900 = { startMinutes: 540, endMinutes: 600, slotMinutes: 60 };
const HORIZON_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Slot {
  startsAt: string;
  endsAt: string;
}

interface SlotsResponse {
  course: { id: string; slug: string; title: string; demoBookingsEnabled: boolean };
  teacher: { id: string; timezone: string };
  entitlement: string;
  denial: string | null;
  from: string;
  to: string;
  slots: Slot[];
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

async function createPublishedCourse(token: string): Promise<{ id: string; slug: string }> {
  courseSequence += 1;
  const slug = `slots-course-${courseSequence}-${RUN}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Speaking practice ${courseSequence} ${MARK}`,
      slug,
      level: 'beginner',
      summary: 'A hour of conversation.',
      description: 'Talk about films, food and travel with corrections as we go.',
    })
    .expect(201);
  const id = res.body.course.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return { id, slug };
}

/** Windows for the whole week, so any day the horizon opens has a class in it. */
async function openWeek(teacher: string, window: Record<string, unknown>) {
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await request(app.getHttpServer())
      .post('/api/v1/availability/rules')
      .set('Authorization', `Bearer ${teacher}`)
      .send({ weekday, ...window })
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

function readSlots(token: string | undefined, course: string): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/bookings/slots').query({ course });
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function slotsFor(token: string, course: string): Promise<SlotsResponse> {
  const res = await readSlots(token, course).expect(200);
  return res.body as SlotsResponse;
}

const valueIds = {
  status(code: string) {
    return prisma.lkpValue
      .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_STATUS } } })
      .then((row) => row.id);
  },
  type(code: string) {
    return prisma.lkpValue
      .findFirstOrThrow({ where: { code, type: { code: LKP_TYPE_CODES.BOOKING_TYPE } } })
      .then((row) => row.id);
  },
};

/**
 * A booking as the table wants it, written straight here because there is no endpoint that makes
 * one yet (4e-3). `slotHeldAt` is the claim the unique index guards, so a released booking has to
 * be written with it cleared — exactly what the cancel path will do.
 */
async function book(args: {
  studentId: string;
  teacherId: string;
  courseId: string;
  startsAt: Date;
  type?: string;
  status?: string;
  holds?: boolean;
  durationMinutes?: number;
}) {
  const holds = args.holds ?? true;
  const status = args.status ?? BOOKING_STATUS_CODES.PENDING;
  const blocking =
    status === BOOKING_STATUS_CODES.PENDING || status === BOOKING_STATUS_CODES.CONFIRMED;
  return prisma.booking.create({
    data: {
      studentUserId: args.studentId,
      teacherUserId: args.teacherId,
      courseId: args.courseId,
      typeValueId: await valueIds.type(args.type ?? BOOKING_TYPE_CODES.ENROLLED),
      statusValueId: await valueIds.status(status),
      startsAt: args.startsAt,
      durationMinutes: args.durationMinutes ?? 60,
      slotHeldAt: holds && blocking ? args.startsAt : null,
    },
  });
}

async function demoEnabled(courseId: string, enabled: boolean) {
  await prisma.course.update({ where: { id: courseId }, data: { demoBookingsEnabled: enabled } });
}

/** The class a day after `n` from the first offer — a minute the grid is known to contain. */
function nthOffer(response: SlotsResponse, n: number): Date {
  return new Date(new Date(response.slots[0]?.startsAt ?? 0).getTime() + n * MS_PER_DAY);
}

/** The first offer, with the compiler told what the test is about to assert anyway. */
function firstSlot(response: SlotsResponse): Slot {
  const slot = response.slots[0];
  if (!slot) throw new Error('The grid came back empty, and this test needs a class in it.');
  return slot;
}

describe('the open class times a student is offered', () => {
  let teacher: string;
  let teacherId: string;
  let quietTeacher: string;
  let enrolled: string;
  let stranger: string;
  let strangerId: string;
  let course: { id: string; slug: string };

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    teacher = await register('slottr', 'teacher');
    quietTeacher = await register('slotqt', 'teacher');
    enrolled = await register('slotin', 'student');
    stranger = await register('slotstg', 'student');
    teacherId = await userIdFor('slottr');
    strangerId = await userIdFor('slotstg');

    // The zone that decides when a window opens lives on the account, not on the rule.
    await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });

    course = await createPublishedCourse(teacher);
    await openWeek(teacher, DAILY_0900);
    await enroll(enrolled, course.id);
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

  it('offers the teacher grid, expanded across the horizon', async () => {
    const res = await slotsFor(enrolled, course.id);

    expect(res.entitlement).toBe('enrolled');
    expect(res.denial).toBeNull();
    // One 09:00 class a day in a zone that never shifts: the horizon is exactly as deep as the
    // platform is willing to look, and every day in it appears once.
    expect(res.slots).toHaveLength(HORIZON_DAYS);
    const starts = res.slots.map((slot) => new Date(slot.startsAt).getTime());
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    const first = starts[0] ?? 0;
    expect(starts.map((at) => at - first)).toEqual(starts.map((_, index) => index * MS_PER_DAY));
    // The horizon is the window searched, and it is the caller's to read: a student who waits
    // and reloads gets a different list, and the response says which range this one covers.
    expect(new Date(res.from).getTime()).toBeLessThanOrEqual(Date.now());
    expect(
      Math.round((new Date(res.to).getTime() - new Date(res.from).getTime()) / MS_PER_DAY),
    ).toBe(HORIZON_DAYS);
  });

  it('names the timezone the grid was cut in, so a screen can show it honestly', async () => {
    const res = await slotsFor(enrolled, course.id);

    expect(res.teacher.timezone).toBe(TEACHER_ZONE);
    // Every offer is 09:00 on the teacher's own clock, whatever minute it is in UTC.
    expect([
      ...new Set(
        res.slots.map((slot) =>
          new Date(slot.startsAt).toLocaleTimeString('en-GB', {
            timeZone: TEACHER_ZONE,
            hour: '2-digit',
            minute: '2-digit',
          }),
        ),
      ),
    ]).toEqual(['09:00']);
    expect(res.slots.length).toBeGreaterThan(0);
    expect(
      (new Date(firstSlot(res).endsAt).getTime() - new Date(firstSlot(res).startsAt).getTime()) /
        60_000,
    ).toBe(DAILY_0900.slotMinutes);
  });

  it('keeps the grid out of the past without shortening the horizon', async () => {
    // A window that covers hours the teacher has already taught through: 00:00 to 06:00 local, so
    // part of today's set is gone by the time the request is answered.
    await openWeek(teacher, { startMinutes: 0, endMinutes: 360, slotMinutes: 60 });

    const res = await slotsFor(enrolled, course.id);
    const from = new Date(res.from).getTime();

    expect(new Date(firstSlot(res).startsAt).getTime()).toBeGreaterThanOrEqual(from);
    // Six classes a day for thirty days is not a list that quietly stops early.
    expect(res.slots.length).toBeGreaterThan(HORIZON_DAYS);
    expect(res.slots.every((slot) => new Date(slot.startsAt).getTime() >= from)).toBe(true);

    await prisma.availabilityRule.deleteMany({
      where: { teacherUserId: teacherId, startMinutes: 0 },
    });
  });

  it('takes a minute a classmate is holding off the grid', async () => {
    const before = await slotsFor(enrolled, course.id);
    const held = nthOffer(before, 3);
    const alsoHeld = nthOffer(before, 4);

    await book({ studentId: strangerId, teacherId, courseId: course.id, startsAt: held });
    await book({
      studentId: strangerId,
      teacherId,
      courseId: course.id,
      startsAt: alsoHeld,
      status: BOOKING_STATUS_CODES.CONFIRMED,
    });

    const after = await slotsFor(enrolled, course.id);
    const offered = after.slots.map((slot) => slot.startsAt);

    expect(offered).not.toContain(held.toISOString());
    expect(offered).not.toContain(alsoHeld.toISOString());
    expect(after.slots).toHaveLength(before.slots.length - 2);
    // An unanswered request is a held minute: the classmate has not been refused yet, and the
    // teacher's answer is not the student reading this list's business.
  });

  it('keeps a minute the standing class is still running through off the grid', async () => {
    // The offer and the write have to run the same arithmetic, or the calendar is a promise the
    // platform breaks on the click. This teacher tiles a two-hour morning into hours, so 10:00 is
    // its own square; a 09:00 class that runs ninety minutes is standing inside that square, and
    // the booking path already refuses it — so the grid may not show it either.
    const HOUR = 60 * 60 * 1000;
    const longTeacher = await register('slotlg', 'teacher');
    const longStudentId = await userIdFor('slotin');
    await prisma.user.update({
      where: { id: await userIdFor('slotlg') },
      data: { timezone: TEACHER_ZONE },
    });
    const longCourse = await createPublishedCourse(longTeacher);
    await openWeek(longTeacher, { startMinutes: 540, endMinutes: 660, slotMinutes: 60 });
    await enroll(enrolled, longCourse.id);

    const before = await slotsFor(enrolled, longCourse.id);
    // Two squares a day, and a run that starts between them splits the pair — so the adjacent pair
    // is found by its own shape rather than by assuming the grid opens today.
    const starts = before.slots.map((slot) => new Date(slot.startsAt));
    const at = starts.findIndex(
      (startsAt, index) => starts[index + 1]?.getTime() === startsAt.getTime() + HOUR,
    );
    const nine = starts[at];
    const ten = starts[at + 1];
    if (!nine || !ten) throw new Error('No two offers in this grid sit an hour apart.');

    await book({
      studentId: longStudentId,
      teacherId: await userIdFor('slotlg'),
      courseId: longCourse.id,
      startsAt: nine,
      status: BOOKING_STATUS_CODES.CONFIRMED,
      durationMinutes: 90,
    });

    const after = await slotsFor(enrolled, longCourse.id);
    const offered = after.slots.map((slot) => slot.startsAt);

    expect(offered).not.toContain(nine.toISOString());
    expect(offered).not.toContain(ten.toISOString());
    expect(after.slots).toHaveLength(before.slots.length - 2);
  });

  it('gives a minute back when the class that held it ended, was cancelled or expired', async () => {
    const before = await slotsFor(enrolled, course.id);
    const settled = [
      BOOKING_STATUS_CODES.CANCELLED,
      BOOKING_STATUS_CODES.COMPLETED,
      BOOKING_STATUS_CODES.REJECTED,
      BOOKING_STATUS_CODES.EXPIRED,
      BOOKING_STATUS_CODES.NO_SHOW,
    ];

    const instants = await Promise.all(
      settled.map(async (status, index) => {
        const startsAt = nthOffer(before, index + 8);
        await book({
          studentId: strangerId,
          teacherId,
          courseId: course.id,
          startsAt,
          status,
        });
        return startsAt;
      }),
    );

    const offered = (await slotsFor(enrolled, course.id)).slots.map((slot) => slot.startsAt);

    for (const instant of instants) expect(offered).toContain(instant.toISOString());
    expect(offered).toHaveLength(before.slots.length);
  });

  it('opens the demo grid to a student with no place, when the teacher allows it', async () => {
    await demoEnabled(course.id, true);

    const res = await slotsFor(stranger, course.id);

    expect(res.entitlement).toBe('demo');
    expect(res.slots.length).toBeGreaterThan(0);

    await demoEnabled(course.id, false);
  });

  it('answers a stranger with a reason when the teacher keeps the calendar to the class', async () => {
    const res = await slotsFor(stranger, course.id);

    expect(res.entitlement).toBe('none');
    expect(res.denial).toBe('enrollment_required');
    expect(res.slots).toEqual([]);
    // The course itself is still described, because the screen has to link the student to enroll.
    expect(res.course.id).toBe(course.id);
  });

  it('gives a student one demo per course, even the one they cancelled', async () => {
    await demoEnabled(course.id, true);
    const taken = nthOffer(await slotsFor(stranger, course.id), 0);
    await book({
      studentId: strangerId,
      teacherId,
      courseId: course.id,
      startsAt: taken,
      type: BOOKING_TYPE_CODES.DEMO,
      status: BOOKING_STATUS_CODES.CANCELLED,
      holds: false,
    });

    const res = await slotsFor(stranger, course.id);

    expect(res.entitlement).toBe('none');
    expect(res.denial).toBe('demo_already_taken');
    expect(res.slots).toEqual([]);

    await prisma.booking.deleteMany({ where: { studentUserId: strangerId } });
    await demoEnabled(course.id, false);
  });

  it('counts a place ahead of a demo', async () => {
    await demoEnabled(course.id, true);

    expect((await slotsFor(enrolled, course.id)).entitlement).toBe('enrolled');

    await demoEnabled(course.id, false);
  });

  it('has nothing to offer a teacher who has set no windows', async () => {
    // A second teacher, because a week belongs to a person rather than a course: the first
    // teacher's Monday morning opens a class in any of their courses, so a course of theirs can
    // never be the empty calendar this test is about.
    const quiet = await createPublishedCourse(quietTeacher);
    await enroll(enrolled, quiet.id);

    const res = await slotsFor(enrolled, quiet.id);

    expect(res.entitlement).toBe('enrolled');
    expect(res.slots).toEqual([]);
  });

  it('accepts the slug a catalog link carries, and answers like the id', async () => {
    const byId = await slotsFor(enrolled, course.id);
    const bySlug = await slotsFor(enrolled, course.slug);

    expect(bySlug.course).toMatchObject({ id: course.id, slug: course.slug });
    expect(bySlug.slots.map((slot) => slot.startsAt)).toEqual(
      byId.slots.map((slot) => slot.startsAt),
    );
  });

  it('will not open a course the shelf does not carry', async () => {
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
    const draftId = draft.body.course.id as string;

    const neverWritten = await readSlots(enrolled, randomUUID()).expect(404);
    const unpublished = await readSlots(enrolled, draftId).expect(404);
    const nonsense = await readSlots(enrolled, 'not-a-course-at-all').expect(404);

    expect(
      new Set([neverWritten.body.message, unpublished.body.message, nonsense.body.message]).size,
    ).toBe(1);
  });

  it('asks which course before it looks anywhere', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/bookings/slots')
      .set('Authorization', `Bearer ${enrolled}`)
      .expect(400);
  });

  it('refuses a caller with no session, and a teacher with a student route', async () => {
    await readSlots(undefined, course.id).expect(401);
    await readSlots(teacher, course.id).expect(403);
  });

  /**
   * A day the teacher marked off is a day they do not teach.
   *
   * The cohort calendar has always known this: the sweep drops an occurrence landing on a holiday,
   * so a repeated class simply does not appear that week (§13). The 1:1 grid is derived from weekly
   * windows rather than read out of a table, and a window says which weekday a teacher keeps open —
   * it says nothing about that person being away on one of them. Until this, a teacher who marked a
   * festival off their calendar still offered it as a free class, and the write still took the
   * minute. The two halves are tested side by side because they are one promise: a square is
   * offered exactly when it can be booked.
   */
  describe('a day the teacher has marked off', () => {
    // Read in the teacher's zone, never as a UTC day: a 00:30 class in Kolkata is a 19:00 instant
    // on the day before, and a teacher who marks off Monday has closed that class either way.
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TEACHER_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dayKey = (startsAt: string) => formatter.format(new Date(startsAt));

    const markOff = (date: string, owner = teacherId) =>
      prisma.holiday.create({ data: { teacherUserId: owner, date } });

    const askFor = (token: string, startsAt: string) =>
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({ course: course.id, startsAt });

    /** The validation half of the error envelope, which is where a screen finds the field to redden. */
    function validation(body: Record<string, unknown>): Record<string, string[]> {
      return (body.details as { validation: Record<string, string[]> }).validation;
    }

    afterAll(async () => {
      const quiet = await userIdFor('slotqt');
      await prisma.holiday.deleteMany({ where: { teacherUserId: { in: [teacherId, quiet] } } });
    });

    it('comes off the grid, taking every class that day holds with it', async () => {
      const before = await slotsFor(enrolled, course.id);
      const away = before.slots[4];
      if (!away) throw new Error('This grid needs a class to mark off.');
      const closed = dayKey(away.startsAt);

      await markOff(closed);

      const after = await slotsFor(enrolled, course.id);
      expect(after.slots.map((slot) => slot.startsAt)).not.toContain(away.startsAt);
      // A day off closes the day, not the one minute the teacher was looking at: every offer that
      // shares its local date goes, however many windows that weekday keeps open.
      expect(after.slots.filter((slot) => dayKey(slot.startsAt) === closed)).toEqual([]);
      expect(after.slots).toHaveLength(
        before.slots.filter((slot) => dayKey(slot.startsAt) !== closed).length,
      );
    });

    it('is not bookable either, so the grid and the write answer the same question', async () => {
      // A day the grid still offers, marked off now: the student could have been looking at the
      // screen before the teacher went away, and the minute they press has to be refused on the way
      // in rather than confirmed and then quietly cancelled.
      const slot = firstSlot(await slotsFor(enrolled, course.id));
      await markOff(dayKey(slot.startsAt));
      const studentId = await userIdFor('slotin');
      const at = {
        courseId: course.id,
        studentUserId: studentId,
        startsAt: new Date(slot.startsAt),
      };
      const written = await prisma.booking.count({ where: at });

      const res = await askFor(enrolled, slot.startsAt).expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(validation(res.body).startsAt).toBeDefined();
      // The refusal wrote nothing, which is the point: a request row here would hold a minute the
      // teacher is away for until the expiry sweep noticed.
      expect(await prisma.booking.count({ where: at })).toBe(written);
    });

    it('closes nothing for a teacher who never marked it', async () => {
      // A holiday belongs to the person who does not teach, not to the course: two teachers can
      // both run a published course, and one's festival cannot empty the other's calendar.
      const before = await slotsFor(enrolled, course.id);
      const quietId = await userIdFor('slotqt');
      await markOff(dayKey(firstSlot(before).startsAt), quietId);

      const after = await slotsFor(enrolled, course.id);
      expect(after.slots.map((slot) => slot.startsAt)).toEqual(
        before.slots.map((slot) => slot.startsAt),
      );
    });

    it('opens the day again once the teacher takes the mark off it', async () => {
      const slot = firstSlot(await slotsFor(enrolled, course.id));
      const marked = await markOff(dayKey(slot.startsAt));

      expect((await slotsFor(enrolled, course.id)).slots.map((s) => s.startsAt)).not.toContain(
        slot.startsAt,
      );

      // Retiring a holiday is the teacher saying they are home after all. The row stays — nothing
      // here is ever deleted — and the grid goes back to what the windows say.
      await prisma.holiday.update({ where: { id: marked.id }, data: { isActive: false } });

      expect((await slotsFor(enrolled, course.id)).slots.map((s) => s.startsAt)).toContain(
        slot.startsAt,
      );
    });
  });
});
