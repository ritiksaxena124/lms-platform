import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `class_series` and `holiday` tables promise with no HTTP in the way: that a teacher's
 * recurring classes are weekly slots owned by a course, that one series per day at a given time
 * keeps the schedule readable, that holidays block whole days for one teacher, and that both
 * tables store plans rather than deciding whether a student may book inside them.
 *
 * A series is a teacher's plan — Monday at 09:00–10:00, Thursday at 14:00–15:00 — and the booking
 * endpoint auto-enrolls students into every instance. A holiday is a day the teacher does not teach,
 * stored as an ISO date because the zone decides when midnight is.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let activeStatusId: string;
let draftStatusId: string;

const createUser = (email: string, roleValueId: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Calendar Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId,
      statusValueId: activeStatusId,
    },
  });

const createTeacher = (email: string) => createUser(email, teacherRoleId);

const createCourse = async (teacherId: string, title: string) =>
  prisma.course.create({
    data: {
      teacherUserId: teacherId,
      title,
      slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${RUN}`,
      levelValueId: await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, 'beginner'),
      statusValueId: draftStatusId,
    },
  });

/** Monday, 09:00–10:00 as a 45-minute class. Times are wall-clock minutes in the teacher's zone. */
const SERIES = { weekday: 1, startMinutes: 9 * 60, endMinutes: 10 * 60, durationMinutes: 45 };

const addSeries = (courseId: string, overrides: Record<string, number> = {}) =>
  prisma.classSeries.create({ data: { courseId, ...SERIES, ...overrides } });

const addHoliday = (teacherId: string, date: string, reason?: string, recurring = false) =>
  prisma.holiday.create({
    data: {
      teacherUserId: teacherId,
      date,
      reason: reason ?? null,
      isRecurringAnnual: recurring,
    },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  draftStatusId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, 'draft');
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({
      where: { email: { endsWith: `@${RUN}.localtest.me` } },
      select: { id: true },
    })
  ).map((u) => u.id);

  if (userIds.length > 0) {
    await prisma.holiday.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.classSeries.deleteMany({
      where: { course: { teacherUserId: { in: userIds } } },
    });
    await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.$disconnect();
});

describe('class_series table', () => {
  it('stores a weekly slot as wall-clock minutes', async () => {
    const teacher = await createTeacher(emailFor('series-teacher'));
    const course = await createCourse(teacher.id, 'Series Math');

    const series = await addSeries(course.id);

    expect(series.weekday).toBe(1);
    expect(series.startMinutes).toBe(540); // 09:00
    expect(series.endMinutes).toBe(600); // 10:00
    expect(series.durationMinutes).toBe(45);
    expect(series.isActive).toBe(true);
  });

  it('prevents two series on the same day at the same start time for one course', async () => {
    const teacher = await createTeacher(emailFor('duplicate-series'));
    const course = await createCourse(teacher.id, 'Duplicate Series');

    await addSeries(course.id, { weekday: 3, startMinutes: 14 * 60 });

    await expect(
      addSeries(course.id, { weekday: 3, startMinutes: 14 * 60 }),
    ).rejects.toThrow();
  });

  it('allows the same time on different days for one course', async () => {
    const teacher = await createTeacher(emailFor('multi-day'));
    const course = await createCourse(teacher.id, 'Multi Day');

    const monday = await addSeries(course.id, { weekday: 1, startMinutes: 9 * 60 });
    const thursday = await addSeries(course.id, { weekday: 4, startMinutes: 9 * 60 });

    expect(monday.weekday).toBe(1);
    expect(thursday.weekday).toBe(4);
  });

  it('allows the same time for different courses of the same teacher', async () => {
    const teacher = await createTeacher(emailFor('two-courses'));
    const math = await createCourse(teacher.id, 'Math');
    const physics = await createCourse(teacher.id, 'Physics');

    const mathSeries = await addSeries(math.id);
    const physicsSeries = await addSeries(physics.id);

    expect(mathSeries.courseId).toBe(math.id);
    expect(physicsSeries.courseId).toBe(physics.id);
  });

  it('keeps a retired series so past bookings can resolve which plan made them possible', async () => {
    const teacher = await createTeacher(emailFor('retired-series'));
    const course = await createCourse(teacher.id, 'Retired Course');

    const series = await addSeries(course.id);
    await prisma.classSeries.update({ where: { id: series.id }, data: { isActive: false } });

    const found = await prisma.classSeries.findUnique({ where: { id: series.id } });
    expect(found?.isActive).toBe(false);
  });
});

describe('holiday table', () => {
  it('stores a whole day as an ISO date string', async () => {
    const teacher = await createTeacher(emailFor('holiday-teacher'));

    const holiday = await addHoliday(teacher.id, '2026-12-25', 'Christmas');

    expect(holiday.date).toBe('2026-12-25');
    expect(holiday.reason).toBe('Christmas');
    expect(holiday.isRecurringAnnual).toBe(false);
    expect(holiday.isActive).toBe(true);
  });

  it('prevents two holidays on the same day for one teacher', async () => {
    const teacher = await createTeacher(emailFor('duplicate-holiday'));

    await addHoliday(teacher.id, '2026-01-01', 'New Year');

    await expect(addHoliday(teacher.id, '2026-01-01', 'Another')).rejects.toThrow();
  });

  it('marks recurring annual holidays separately from one-offs', async () => {
    const teacher = await createTeacher(emailFor('recurring-holiday'));

    const diwali = await addHoliday(teacher.id, '2026-11-01', 'Diwali', true);
    const personal = await addHoliday(teacher.id, '2026-06-15', 'Day off', false);

    expect(diwali.isRecurringAnnual).toBe(true);
    expect(personal.isRecurringAnnual).toBe(false);
  });

  it('allows the same date for different teachers', async () => {
    const teacher1 = await createTeacher(emailFor('teacher1-holiday'));
    const teacher2 = await createTeacher(emailFor('teacher2-holiday'));

    const h1 = await addHoliday(teacher1.id, '2026-12-25', 'Christmas');
    const h2 = await addHoliday(teacher2.id, '2026-12-25', 'Christmas');

    expect(h1.teacherUserId).toBe(teacher1.id);
    expect(h2.teacherUserId).toBe(teacher2.id);
  });

  it('allows a nullable reason field', async () => {
    const teacher = await createTeacher(emailFor('no-reason'));

    const holiday = await addHoliday(teacher.id, '2026-07-04');

    expect(holiday.reason).toBeNull();
  });

  it('keeps a deactivated holiday so the record stays', async () => {
    const teacher = await createTeacher(emailFor('deactivated-holiday'));

    const holiday = await addHoliday(teacher.id, '2026-03-17', 'St Patrick');
    await prisma.holiday.update({ where: { id: holiday.id }, data: { isActive: false } });

    const found = await prisma.holiday.findUnique({ where: { id: holiday.id } });
    expect(found?.isActive).toBe(false);
  });
});
