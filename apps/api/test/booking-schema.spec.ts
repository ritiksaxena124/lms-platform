import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BOOKING_STATUS_CODES,
  BOOKING_TYPE_CODES,
  COURSE_LEVEL_CODES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  ROLE_CODES,
} from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `booking` table promises with no HTTP in the way: that a class a student claimed is
 * one row naming a student, a teacher, a course, an instant and a length; that a minute of a
 * teacher's calendar is claimed by at most one standing class — from either kind of booking and
 * from either of that teacher's courses, because the pool is shared (ARCHITECTURE §5); and that
 * giving a minute back releases it while the row that held it survives as history.
 *
 * Which statuses occupy a minute, whether this student may book this course at all, and the
 * one-demo-ever cap are the booking endpoint's decisions. The table is the race guard underneath
 * them: it can hold a minute against a second writer, but it cannot know what a status means,
 * because a status is a lookup row Ops can rename (§3).
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let studentRoleId: string;
let activeStatusId: string;
let beginnerId: string;
let courseDraftId: string;
let enrolledTypeId: string;
let demoTypeId: string;
let pendingStatusId: string;
let cancelledStatusId: string;

const createUser = (email: string, roleValueId: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Booking Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId,
      statusValueId: activeStatusId,
    },
  });

const createStudent = (email: string) => createUser(email, studentRoleId);
const createTeacher = (email: string) => createUser(email, teacherRoleId);

const createCourse = (teacherId: string, slug: string) =>
  prisma.course.create({
    data: {
      teacherUserId: teacherId,
      title: 'Fractions, slowly',
      slug,
      levelValueId: beginnerId,
      statusValueId: courseDraftId,
    },
  });

/** Monday 09:00 in Kolkata, as the generator would have written it: one UTC instant. */
const INSTANT = new Date('2026-10-05T03:30:00.000Z');
const later = (minutes: number) => new Date(INSTANT.getTime() + minutes * 60_000);

/**
 * `slotHeldAt` is written by hand here because it is the endpoint's answer, not a column
 * default: it names the instant this row keeps claimed on the teacher's calendar, and nothing
 * for a row that claims none. The tests that follow are about what that one column does under a
 * unique index, and the one about it *not* moving with the status is the reason 4e writes both
 * from `BLOCKING_BOOKING_STATUSES` in the same statement.
 */
const book = (
  studentId: string,
  teacherId: string,
  courseId: string,
  overrides: Record<string, unknown> = {},
) =>
  prisma.booking.create({
    data: {
      studentUserId: studentId,
      teacherUserId: teacherId,
      courseId,
      typeValueId: enrolledTypeId,
      statusValueId: pendingStatusId,
      startsAt: INSTANT,
      durationMinutes: 45,
      slotHeldAt: INSTANT,
      ...overrides,
    },
  });

/** The cancel the endpoint performs: the status moves and the minute goes back. */
const release = (id: string) =>
  prisma.booking.update({
    where: { id },
    data: { statusValueId: cancelledStatusId, slotHeldAt: null },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  studentRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.STUDENT);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  beginnerId = await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, COURSE_LEVEL_CODES.BEGINNER);
  courseDraftId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.DRAFT);
  enrolledTypeId = await lookupValue(LKP_TYPE_CODES.BOOKING_TYPE, BOOKING_TYPE_CODES.ENROLLED);
  demoTypeId = await lookupValue(LKP_TYPE_CODES.BOOKING_TYPE, BOOKING_TYPE_CODES.DEMO);
  pendingStatusId = await lookupValue(LKP_TYPE_CODES.BOOKING_STATUS, BOOKING_STATUS_CODES.PENDING);
  cancelledStatusId = await lookupValue(
    LKP_TYPE_CODES.BOOKING_STATUS,
    BOOKING_STATUS_CODES.CANCELLED,
  );
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  const courseIds = (
    await prisma.course.findMany({
      where: { teacherUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.booking.deleteMany({
    where: {
      OR: [
        { studentUserId: { in: userIds } },
        { teacherUserId: { in: userIds } },
        { courseId: { in: courseIds } },
      ],
    },
  });
  await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: userIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('booking table', () => {
  it('records the class that was claimed, exactly as it was claimed', async () => {
    const owner = await createTeacher(emailFor('owner'));
    const student = await createStudent(emailFor('student'));
    const course = await createCourse(owner.id, `claimed-${RUN}`);

    const created = await book(student.id, owner.id, course.id);

    // Who booked it, whose calendar it sits on, what it is about, when it starts and how long
    // it runs. The length is frozen here rather than read from the teacher's rule at display
    // time: a class booked as 45 minutes stays a 45-minute class after the teacher starts
    // teaching an hour, and a student's calendar would otherwise redraw history.
    expect(created).toMatchObject({
      studentUserId: student.id,
      teacherUserId: owner.id,
      courseId: course.id,
      typeValueId: enrolledTypeId,
      statusValueId: pendingStatusId,
      startsAt: INSTANT,
      durationMinutes: 45,
      slotHeldAt: INSTANT,
      isActive: true,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("holds one teacher's minute against every other student", async () => {
    const owner = await createTeacher(emailFor('pool-owner'));
    const first = await createStudent(emailFor('pool-first'));
    const second = await createStudent(emailFor('pool-second'));
    const maths = await createCourse(owner.id, `pool-maths-${RUN}`);
    const physics = await createCourse(owner.id, `pool-physics-${RUN}`);

    await book(first.id, owner.id, maths.id);

    // One shared pool is the whole design: two courses of the same teacher at the same instant
    // would be one teacher in two rooms, and the key that prevents it cannot name a course.
    await expect(book(second.id, owner.id, physics.id)).rejects.toMatchObject({ code: 'P2002' });
    // The next minute of the same window is a second class, not a collision.
    await expect(
      book(second.id, owner.id, maths.id, { startsAt: later(45), slotHeldAt: later(45) }),
    ).resolves.toMatchObject({ startsAt: later(45) });
  });

  it('lets two teachers take the same instant, because each calendar is its own', async () => {
    const one = await createTeacher(emailFor('dual-one'));
    const two = await createTeacher(emailFor('dual-two'));
    const student = await createStudent(emailFor('dual'));
    const first = await createCourse(one.id, `dual-a-${RUN}`);
    const second = await createCourse(two.id, `dual-b-${RUN}`);

    await expect(book(student.id, one.id, first.id)).resolves.toMatchObject({
      teacherUserId: one.id,
    });
    await expect(book(student.id, two.id, second.id)).resolves.toMatchObject({
      teacherUserId: two.id,
    });
  });

  it('returns a cancelled class to the calendar and keeps the row as history', async () => {
    const owner = await createTeacher(emailFor('release-owner'));
    const leaver = await createStudent(emailFor('release-leaver'));
    const taker = await createStudent(emailFor('release-taker'));
    const course = await createCourse(owner.id, `release-${RUN}`);

    const cancelled = await book(leaver.id, owner.id, course.id);
    await release(cancelled.id);

    // The minute goes back to the pool for whoever wants it next.
    await expect(book(taker.id, owner.id, course.id)).resolves.toMatchObject({
      studentUserId: taker.id,
    });

    // and the row that gave it up is still there, still active, still cancelled: the student's
    // own class list shows the call they called off, and a booking history that was rebuilt by
    // deleting rows would show them a calendar that never had it.
    const kept = await prisma.booking.findUniqueOrThrow({ where: { id: cancelled.id } });
    expect(kept).toMatchObject({ statusValueId: cancelledStatusId, isActive: true });
    expect(kept.slotHeldAt).toBeNull();
  });

  it('takes a released minute back as the same row, not a second claim on the pair', async () => {
    const owner = await createTeacher(emailFor('rebook-owner'));
    const student = await createStudent(emailFor('rebook'));
    const course = await createCourse(owner.id, `rebook-${RUN}`);

    const cancelled = await book(student.id, owner.id, course.id);
    await release(cancelled.id);
    // Nothing here says "one booking per student per course", so the same student may take a
    // second class in the same course. That is the shape a term of lessons has, and it is why
    // the demo cap has to be a query over surviving rows rather than a key (see below).
    await expect(
      book(student.id, owner.id, course.id, { startsAt: later(45), slotHeldAt: later(45) }),
    ).resolves.toMatchObject({ startsAt: later(45) });

    const again = await book(student.id, owner.id, course.id);
    expect(again.id).not.toBe(cancelled.id);
  });

  it('does not know which statuses occupy a minute', async () => {
    const owner = await createTeacher(emailFor('status-owner'));
    const holder = await createStudent(emailFor('status-holder'));
    const taker = await createStudent(emailFor('status-taker'));
    const course = await createCourse(owner.id, `status-${RUN}`);

    const moved = await book(holder.id, owner.id, course.id);
    // A writer that sets the status and leaves the claim in place keeps the minute blocked.
    // This is not a bug to fix with a database trigger: `cancelled` is a `LkpValue` row, and an
    // index cannot ask a lookup row what it means. It is the reason 4e writes the status and the
    // claim from `BLOCKING_BOOKING_STATUSES` as one decision, in one update.
    await prisma.booking.update({
      where: { id: moved.id },
      data: { statusValueId: cancelledStatusId },
    });

    await expect(book(taker.id, owner.id, course.id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('makes no decision about who may book', async () => {
    const owner = await createTeacher(emailFor('gate-owner'));
    const outsider = await createStudent(emailFor('gate-outsider'));
    const course = await createCourse(owner.id, `gate-${RUN}`);

    // No enrollment row exists for this student, and the table does not care: the endpoint that
    // takes a normal live slot checks the roster, because "who counts as enrolled" is a rule
    // Phase 5's coupons and refunds can change.
    await expect(book(outsider.id, owner.id, course.id)).resolves.toMatchObject({
      studentUserId: outsider.id,
    });

    // A teacher on their own calendar, and a demo on a course whose teacher never opened them —
    // both refused by the endpoint, neither a column. The opt-in flag is a fact about the course,
    // and a booking row that also carried it would be a second copy to keep in step.
    // The minute is a later one: the outsider's class above is standing on the teacher's calendar
    // already, and the pool does not care which kind of booking asked for it.
    await expect(
      book(owner.id, owner.id, course.id, {
        typeValueId: demoTypeId,
        startsAt: later(45),
        slotHeldAt: later(45),
      }),
    ).resolves.toMatchObject({ typeValueId: demoTypeId });

    const fresh = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(fresh.demoBookingsEnabled).toBe(false);
  });

  it('counts one demo ever only if something asks it to, which it does not', async () => {
    const owner = await createTeacher(emailFor('demo-owner'));
    const student = await createStudent(emailFor('demo'));
    const course = await createCourse(owner.id, `demo-${RUN}`);

    await expect(
      book(student.id, owner.id, course.id, { typeValueId: demoTypeId }),
    ).resolves.toMatchObject({ typeValueId: demoTypeId });
    // Two demo rows for one pair, at two instants, both accepted. A unique key here would freeze
    // the cap at one forever, and the cap is a business number: the day Ops wants trials to be a
    // two-call offer, a constraint would be a migration and a rewrite of history.
    await expect(
      book(student.id, owner.id, course.id, {
        typeValueId: demoTypeId,
        startsAt: later(45),
        slotHeldAt: later(45),
      }),
    ).resolves.toMatchObject({ startsAt: later(45) });
    // A cancelled demo is not a free second try either — the row survives, which is what makes
    // "ever" a countable question for the endpoint rather than a gap in the table.
  });

  it('will not name a person, a course, a kind or a status that does not exist', async () => {
    const owner = await createTeacher(emailFor('ghost-owner'));
    const student = await createStudent(emailFor('ghost'));
    const course = await createCourse(owner.id, `ghost-${RUN}`);

    await expect(book(randomUUID(), owner.id, course.id)).rejects.toThrow();
    await expect(book(student.id, randomUUID(), course.id)).rejects.toThrow();
    await expect(book(student.id, owner.id, randomUUID())).rejects.toThrow();
    await expect(
      book(student.id, owner.id, course.id, { typeValueId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      book(student.id, owner.id, course.id, { statusValueId: randomUUID() }),
    ).rejects.toThrow();
  });

  it('will not let booked things disappear underneath them', async () => {
    const owner = await createTeacher(emailFor('kept-owner'));
    const student = await createStudent(emailFor('kept'));
    const course = await createCourse(owner.id, `kept-${RUN}`);
    await book(student.id, owner.id, course.id);

    // Archiving is how a course or a teacher retires. A delete that swept the classes booked
    // from them would erase a student's record of a lesson they attended.
    await expect(prisma.course.delete({ where: { id: course.id } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: owner.id } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: student.id } })).rejects.toThrow();
  });

  it('will not let a booking status or a booking kind be dropped while a row names it', async () => {
    const owner = await createTeacher(emailFor('lookup-owner'));
    const student = await createStudent(emailFor('lookup'));
    const course = await createCourse(owner.id, `lookup-${RUN}`);
    await book(student.id, owner.id, course.id);

    // The reason lookups are rows and not enums: retiring a status is a `isActive` flip, and the
    // foreign key is what proves a flip cannot orphan the bookings written under it.
    await expect(prisma.lkpValue.delete({ where: { id: pendingStatusId } })).rejects.toThrow();
    await expect(prisma.lkpValue.delete({ where: { id: enrolledTypeId } })).rejects.toThrow();
  });

  it('stores the instant, not the clock face a student read', async () => {
    const owner = await createTeacher(emailFor('utc-owner'));
    const student = await createStudent(emailFor('utc'));
    const course = await createCourse(owner.id, `utc-${RUN}`);

    // 03:30 UTC is 09:00 in the teacher's declared zone. The row holds the instant, so the same
    // class written by a Kolkata teacher and a Lisbon teacher at their own 09:00 are two
    // different claims — which is what makes a DST shift move a class instead of breaking it.
    const created = await book(student.id, owner.id, course.id);
    expect(created.startsAt.toISOString()).toBe('2026-10-05T03:30:00.000Z');
    expect(created.startsAt.getTime()).toBe(INSTANT.getTime());

    const shifted = await book(student.id, owner.id, course.id, {
      startsAt: later(60),
      slotHeldAt: later(60),
    });
    expect(shifted.startsAt.getTime()).toBe(INSTANT.getTime() + 3_600_000);
  });
});
