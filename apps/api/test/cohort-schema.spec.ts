import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ATTENDANCE_STATUS_CODES, LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the two cohort tables promise, with no HTTP in the way.
 *
 * `class_series` records a plan and `booking` records a student's claim on one minute of a
 * teacher's calendar — and neither of those can hold "this class belongs to everyone in the
 * course", because the booking table's race guard is literally one row per teacher per minute.
 * So a dated class gets its own aggregate. What this file pins down is the shape of it: one row
 * per pattern per instant, a sheet of names beside it that is written before anyone attends, and
 * the two facts the platform refuses to lose — that a class happened, and that a person was
 * expected at it.
 *
 * Nothing here decides whether a class *should* exist. That arithmetic is `expandSeries` in
 * @lms/shared and is tested there; these rows are what it writes down.
 */
const RUN = randomUUID().slice(0, 8);
const DOMAIN = `${RUN}.localtest.me`;
const emailFor = (name: string) => `${name}@${DOMAIN}`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let studentRoleId: string;
let activeStatusId: string;
let draftStatusId: string;
let presentStatusId: string;
let absentStatusId: string;

const createUser = (email: string, roleValueId: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Cohort Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId,
      statusValueId: activeStatusId,
    },
  });

const createTeacher = (email: string) => createUser(email, teacherRoleId);
const createStudent = (email: string) => createUser(email, studentRoleId);

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

/** Monday 09:00–11:00, an hour at a time — the plan, not the dated row. */
const SERIES = { weekday: 1, startMinutes: 9 * 60, endMinutes: 11 * 60, durationMinutes: 60 };

const addSeries = (courseId: string, overrides: Record<string, unknown> = {}) =>
  prisma.classSeries.create({ data: { courseId, ...SERIES, ...overrides } });

/** A Monday morning in Kolkata, expressed as the instant the generator would have produced. */
const MONDAY = new Date('2026-10-05T03:30:00.000Z');
const MONDAY_NEXT = new Date('2026-10-12T03:30:00.000Z');

const addOccurrence = (
  seriesId: string,
  courseId: string,
  teacherUserId: string,
  startsAt: Date = MONDAY,
  overrides: Record<string, unknown> = {},
) =>
  prisma.classOccurrence.create({
    data: { seriesId, courseId, teacherUserId, startsAt, durationMinutes: 60, ...overrides },
  });

const addSheetRow = (occurrenceId: string, studentUserId: string) =>
  prisma.classAttendance.create({ data: { occurrenceId, studentUserId } });

const enroll = (courseId: string, studentUserId: string) =>
  prisma.enrollment.create({ data: { courseId, studentUserId } });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  studentRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.STUDENT);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  draftStatusId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, 'draft');
  presentStatusId = await lookupValue(
    LKP_TYPE_CODES.ATTENDANCE_STATUS,
    ATTENDANCE_STATUS_CODES.PRESENT,
  );
  absentStatusId = await lookupValue(
    LKP_TYPE_CODES.ATTENDANCE_STATUS,
    ATTENDANCE_STATUS_CODES.ABSENT,
  );
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({
      where: { email: { endsWith: `@${RUN}.localtest.me` } },
      select: { id: true },
    })
  ).map((u) => u.id);

  if (userIds.length > 0) {
    await prisma.classAttendance.deleteMany({ where: { studentUserId: { in: userIds } } });
    await prisma.classOccurrence.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
    await prisma.holiday.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.classSeries.deleteMany({ where: { course: { teacherUserId: { in: userIds } } } });
    await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.$disconnect();
});

describe('class_occurrence table', () => {
  it('holds a dated class the series made, with the length frozen at that moment', async () => {
    const teacher = await createTeacher(emailFor('occ-teacher'));
    const course = await createCourse(teacher.id, 'Occurrence Math');
    const series = await addSeries(course.id);

    const occurrence = await addOccurrence(series.id, course.id, teacher.id);

    expect(occurrence.startsAt).toEqual(MONDAY);
    expect(occurrence.durationMinutes).toBe(60);
    expect(occurrence.courseId).toBe(course.id);
    // The teacher is a column rather than only a join, for the same reason `booking` carries one:
    // a calendar that spans every course asks "what does this person teach this week", and an
    // index cannot reach through two relations to answer it.
    expect(occurrence.teacherUserId).toBe(teacher.id);
    expect(occurrence.isActive).toBe(true);
  });

  it('opens one row per pattern per instant, and no more', async () => {
    const teacher = await createTeacher(emailFor('occ-duplicate'));
    const course = await createCourse(teacher.id, 'Duplicate Occurrence');
    const series = await addSeries(course.id);

    await addOccurrence(series.id, course.id, teacher.id);

    // The sweep runs on a clock and two API instances may run it at once, so this index — not a
    // read-then-write — is what keeps a week of classes from appearing twice.
    await expect(addOccurrence(series.id, course.id, teacher.id)).rejects.toThrow();
  });

  it('keeps the same instant for the weeks that follow', async () => {
    const teacher = await createTeacher(emailFor('occ-weeks'));
    const course = await createCourse(teacher.id, 'Weekly Occurrences');
    const series = await addSeries(course.id);

    const first = await addOccurrence(series.id, course.id, teacher.id, MONDAY);
    const second = await addOccurrence(series.id, course.id, teacher.id, MONDAY_NEXT);

    expect([first.startsAt, second.startsAt]).toEqual([MONDAY, MONDAY_NEXT]);
  });

  it('lets two courses of one teacher meet at the same minute', async () => {
    // A deliberate gap, not an oversight: the pattern key is per course, so a teacher with Monday
    // 09:00 in two courses has two classes at 09:00 and the platform shows both rather than
    // refusing to generate the second. `booking` cannot make that promise because its race guard
    // is the teacher's minute; a generated row has no such claim to keep.
    const teacher = await createTeacher(emailFor('occ-two-courses'));
    const math = await createCourse(teacher.id, 'Occ Math');
    const physics = await createCourse(teacher.id, 'Occ Physics');
    const mathSeries = await addSeries(math.id);
    const physicsSeries = await addSeries(physics.id);

    const first = await addOccurrence(mathSeries.id, math.id, teacher.id);
    const second = await addOccurrence(physicsSeries.id, physics.id, teacher.id);

    expect([first.courseId, second.courseId]).toEqual([math.id, physics.id]);
  });

  it('keeps a retired occurrence so the sheet beside it still resolves', async () => {
    const teacher = await createTeacher(emailFor('occ-retired'));
    const course = await createCourse(teacher.id, 'Retired Occurrence');
    const series = await addSeries(course.id);

    const occurrence = await addOccurrence(series.id, course.id, teacher.id);
    await prisma.classOccurrence.update({
      where: { id: occurrence.id },
      data: { isActive: false },
    });

    const found = await prisma.classOccurrence.findUnique({ where: { id: occurrence.id } });
    expect(found?.isActive).toBe(false);
  });
});

describe('class_attendance table', () => {
  it('writes a name against a class before anyone has come', async () => {
    const teacher = await createTeacher(emailFor('sheet-teacher'));
    const student = await createStudent(emailFor('sheet-student'));
    const course = await createCourse(teacher.id, 'Sheet Math');
    const series = await addSeries(course.id);
    const occurrence = await addOccurrence(series.id, course.id, teacher.id);

    const row = await addSheetRow(occurrence.id, student.id);

    // Unmarked, which is a null rather than a code for "pending": the absence of a mark is the
    // honest state, and a code for it would be a status nobody ever chose.
    expect(row.statusValueId).toBeNull();
    expect(row.isActive).toBe(true);
  });

  it('names one person once per class', async () => {
    const teacher = await createTeacher(emailFor('sheet-duplicate'));
    const student = await createStudent(emailFor('sheet-duplicate-student'));
    const course = await createCourse(teacher.id, 'Sheet Duplicate');
    const series = await addSeries(course.id);
    const occurrence = await addOccurrence(series.id, course.id, teacher.id);

    await addSheetRow(occurrence.id, student.id);

    await expect(addSheetRow(occurrence.id, student.id)).rejects.toThrow();
  });

  it('holds the whole cohort, and lets each name be marked on its own', async () => {
    const teacher = await createTeacher(emailFor('sheet-cohort'));
    const first = await createStudent(emailFor('sheet-cohort-a'));
    const second = await createStudent(emailFor('sheet-cohort-b'));
    const course = await createCourse(teacher.id, 'Sheet Cohort');
    const series = await addSeries(course.id);
    const occurrence = await addOccurrence(series.id, course.id, teacher.id);

    const a = await addSheetRow(occurrence.id, first.id);
    const b = await addSheetRow(occurrence.id, second.id);

    await prisma.classAttendance.update({
      where: { id: a.id },
      data: { statusValueId: presentStatusId },
    });
    await prisma.classAttendance.update({
      where: { id: b.id },
      data: { statusValueId: absentStatusId },
    });

    const rows = await prisma.classAttendance.findMany({
      where: { occurrenceId: occurrence.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => row.statusValueId)).toEqual([presentStatusId, absentStatusId]);
  });

  it('gives the same person their own line in every week of the term', async () => {
    const teacher = await createTeacher(emailFor('sheet-term'));
    const student = await createStudent(emailFor('sheet-term-student'));
    const course = await createCourse(teacher.id, 'Sheet Term');
    const series = await addSeries(course.id);
    const weekOne = await addOccurrence(series.id, course.id, teacher.id, MONDAY);
    const weekTwo = await addOccurrence(series.id, course.id, teacher.id, MONDAY_NEXT);

    const first = await addSheetRow(weekOne.id, student.id);
    const second = await addSheetRow(weekTwo.id, student.id);

    expect(new Set([first.id, second.id]).size).toBe(2);
  });

  it('keeps a mark once it is made', async () => {
    const teacher = await createTeacher(emailFor('sheet-kept'));
    const student = await createStudent(emailFor('sheet-kept-student'));
    const course = await createCourse(teacher.id, 'Sheet Kept');
    const series = await addSeries(course.id);
    const occurrence = await addOccurrence(series.id, course.id, teacher.id);

    const row = await addSheetRow(occurrence.id, student.id);
    await prisma.classAttendance.update({
      where: { id: row.id },
      data: { statusValueId: presentStatusId, isActive: false },
    });

    const found = await prisma.classAttendance.findUnique({ where: { id: row.id } });
    expect(found?.statusValueId).toBe(presentStatusId);
    expect(found?.isActive).toBe(false);
  });

  it('does not require a place in the course to hold a name', async () => {
    // Deliberate: the sheet is written from the roster by the generator, and a student whose
    // place is later closed keeps the line they were given. Making the row depend on
    // `enrollment` would let a leave reach back and un-answer the question "was this person
    // expected on that Monday", which is a fact about that day rather than about now.
    const teacher = await createTeacher(emailFor('sheet-no-place'));
    const student = await createStudent(emailFor('sheet-no-place-student'));
    const course = await createCourse(teacher.id, 'Sheet No Place');
    const series = await addSeries(course.id);
    const occurrence = await addOccurrence(series.id, course.id, teacher.id);

    const row = await addSheetRow(occurrence.id, student.id);
    expect(row.studentUserId).toBe(student.id);

    await enroll(course.id, student.id);
    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { courseId: course.id, studentUserId: student.id },
    });
    expect(enrollment.isActive).toBe(true);
  });
});
