import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/** One live plan, as much of it as a dated row is written from. */
export type SeriesForGenerator = Prisma.ClassSeriesGetPayload<{
  select: typeof SERIES_FOR_GENERATOR;
}>;

const SERIES_FOR_GENERATOR = {
  id: true,
  courseId: true,
  weekday: true,
  startMinutes: true,
  endMinutes: true,
  durationMinutes: true,
  isActive: true,
} as const satisfies Prisma.ClassSeriesSelect;

/** A dated class in the sweep's own reach, plus the flag that says whether it still stands. */
export type OccurrenceInRange = Prisma.ClassOccurrenceGetPayload<{
  select: typeof OCCURRENCE_IN_RANGE;
}>;

const OCCURRENCE_IN_RANGE = {
  id: true,
  seriesId: true,
  courseId: true,
  startsAt: true,
  isActive: true,
} as const satisfies Prisma.ClassOccurrenceSelect;

/** The register of a dated class, whether or not anybody is still on it. */
export type SheetRow = Prisma.ClassAttendanceGetPayload<{ select: typeof SHEET_ROW }>;

const SHEET_ROW = {
  id: true,
  occurrenceId: true,
  studentUserId: true,
  isActive: true,
} as const satisfies Prisma.ClassAttendanceSelect;

/** A line as the teacher who marks it reads it: the person, and the answer on the line. */
export type RollLineRow = Prisma.ClassAttendanceGetPayload<{ select: typeof ROLL_LINE }>;

const ROLL_LINE = {
  id: true,
  studentUserId: true,
  student: { select: { id: true, fullName: true } },
  status: { select: { code: true } },
} as const satisfies Prisma.ClassAttendanceSelect;

/** One class with its sheet under it, as much of it as a roll needs to answer with. */
export type RollClassRow = Prisma.ClassOccurrenceGetPayload<{ select: typeof ROLL_CLASS }>;

const ROLL_CLASS = {
  id: true,
  startsAt: true,
  durationMinutes: true,
  course: { select: { id: true, slug: true, title: true } },
  attendances: {
    where: { isActive: true },
    // Down the sheet in the order a person reads it. Two names the same is possible, so the line
    // id breaks the tie and the list stays the same shape every time it is read.
    orderBy: [{ student: { fullName: 'asc' } }, { id: 'asc' }],
    select: ROLL_LINE,
  },
} as const satisfies Prisma.ClassOccurrenceSelect;

/** One class the generator has decided exists, before it has a row. */
export type NewOccurrence = {
  seriesId: string;
  courseId: string;
  teacherUserId: string;
  startsAt: Date;
  durationMinutes: number;
};

/**
 * The two cohort tables, and only the shapes the sweep and the two reads need.
 *
 * Every write here is a diff rather than a rebuild, and every read carries its caller in the
 * `where` clause — a teacher's list by the account that teaches, a student's by the place they
 * hold. That is the same rule the rest of the platform runs on: another person's calendar answers
 * like a uuid nobody wrote.
 *
 * The sweep reads rows it is about to *close* as well as the ones it keeps, because a diff needs
 * both halves. Nothing here deletes: a dated class that stopped being true is retired where it
 * stands, and the register beside it still resolves to it (§2).
 */
@Injectable()
export class ClassOccurrenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whom the clock has to visit: every account with a live plan on a live course.
   *
   * Read through the series rather than through the dated rows, because that is the question the
   * sweep answers — whose calendar is owed classes — and a teacher whose first run never landed
   * has no rows to be discovered by. A teacher with no plan is not asked, so the run costs the
   * number of timetables in the platform rather than the number of accounts.
   */
  async listTeachersWithSeries(): Promise<string[]> {
    const rows = await this.prisma.course.findMany({
      where: { isActive: true, classSeries: { some: { isActive: true } } },
      select: { teacherUserId: true },
      distinct: ['teacherUserId'],
    });
    return rows.map((row) => row.teacherUserId);
  }

  /** The wall clock this teacher's week is cut in. Defaults the way the column does. */
  async teacherZone(teacherUserId: string): Promise<string> {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherUserId },
      select: { timezone: true },
    });
    return teacher?.timezone ?? 'UTC';
  }

  /** Every live plan of one teacher, across all their courses, in the order a week reads. */
  async listSeriesForTeacher(teacherUserId: string): Promise<SeriesForGenerator[]> {
    return this.prisma.classSeries.findMany({
      where: { isActive: true, course: { teacherUserId, isActive: true } },
      select: SERIES_FOR_GENERATOR,
      orderBy: [{ courseId: 'asc' }, { weekday: 'asc' }, { startMinutes: 'asc' }],
    });
  }

  /**
   * Every dated class this teacher owns between two instants, standing or not.
   *
   * The inactive half has to come back too: a teacher who lifts a [[holiday]] is looking at rows
   * that were closed by the sweep and have to be reopened, and a read that only returned the live
   * ones would write a second row beside the retired one instead.
   */
  async listOccurrencesBetween(
    teacherUserId: string,
    from: Date,
    to: Date,
  ): Promise<OccurrenceInRange[]> {
    return this.prisma.classOccurrence.findMany({
      where: { teacherUserId, startsAt: { gte: from, lt: to } },
      select: OCCURRENCE_IN_RANGE,
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Write the classes the pattern opens.
   *
   * `skipDuplicates` is the race guard: the key is (series, instant), and two API instances running
   * the same sweep — or a sweep beside a teacher's own write — both land on the same rows rather
   * than one of them failing on a unique violation.
   */
  async createOccurrences(rows: NewOccurrence[]): Promise<number> {
    if (rows.length === 0) return 0;
    const written = await this.prisma.classOccurrence.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return written.count;
  }

  /** Move a set of dated classes to standing or to retired, in one statement. */
  async setOccurrencesActive(ids: string[], isActive: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    const moved = await this.prisma.classOccurrence.updateMany({
      where: { id: { in: ids } },
      data: { isActive },
    });
    return moved.count;
  }

  /** The registers of a set of classes, every name on them, whether or not it still holds a place. */
  async listSheetRows(occurrenceIds: string[]): Promise<SheetRow[]> {
    if (occurrenceIds.length === 0) return [];
    return this.prisma.classAttendance.findMany({
      where: { occurrenceId: { in: occurrenceIds } },
      select: SHEET_ROW,
    });
  }

  /** Write the names a class is standing for. Same race guard and the same reason. */
  async createSheetRows(
    rows: Array<{ occurrenceId: string; studentUserId: string }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const written = await this.prisma.classAttendance.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return written.count;
  }

  /** Move a set of register lines on or off the classes still to come. */
  async setSheetRowsActive(ids: string[], isActive: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    const moved = await this.prisma.classAttendance.updateMany({
      where: { id: { in: ids } },
      data: { isActive },
    });
    return moved.count;
  }

  /**
   * One class and the sheet under it, for the teacher the class is theirs.
   *
   * The caller's id is in the `where` rather than checked afterwards, which is how every other read
   * in this file answers a stranger: the address is a lookup key, and a class that is not yours is
   * the same answer as a class that was never written.
   *
   * A retired class is not here either. Retiring a row is the sweep saying this class will not
   * happen, and a register nobody will stand in front of has no answers to write down.
   */
  async classForRoll(teacherUserId: string, occurrenceId: string): Promise<RollClassRow | null> {
    const found = await this.prisma.classOccurrence.findFirst({
      where: { id: occurrenceId, teacherUserId, isActive: true },
      select: ROLL_CLASS,
    });
    return found ?? null;
  }

  /**
   * Write the marks, one statement per answer rather than one per name.
   *
   * The groups are already split by the caller, so a class of thirty people is three statements and
   * one round trip. They go through `$transaction` as a list because the answers are one decision:
   * a roll that saved the presents and lost the absents on the way is a sheet that says something
   * the teacher never said.
   *
   * `isActive: true` is on every write, so a mark cannot land on the line of a person who no longer
   * holds a place. Their row and its answer stay for the history to read; they are just not on the
   * sheet anybody is marking now.
   */
  async markSheet(
    occurrenceId: string,
    groups: Array<{ statusValueId: string | null; studentUserIds: string[] }>,
  ): Promise<void> {
    const writes = groups
      .filter((group) => group.studentUserIds.length > 0)
      .map((group) =>
        this.prisma.classAttendance.updateMany({
          where: { occurrenceId, studentUserId: { in: group.studentUserIds }, isActive: true },
          data: { statusValueId: group.statusValueId },
        }),
      );

    if (writes.length > 0) await this.prisma.$transaction(writes);
  }

  /**
   * The teacher's own list: dated classes standing in a window, with the course and the number of
   * names each one is standing for.
   *
   * Retired rows are left out — a class the platform no longer believes in is not a day a teacher
   * has to keep free — and the register filters `isActive` on the line rather than counting everybody
   * who was ever written, because a departed student is not somebody to prepare a lesson for.
   */
  async listTeaching(teacherUserId: string, from: Date, to: Date) {
    return this.prisma.classOccurrence.findMany({
      where: { teacherUserId, isActive: true, startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        seriesId: true,
        startsAt: true,
        durationMinutes: true,
        course: { select: { id: true, slug: true, title: true } },
        // The names rather than a count of them: Prisma's `_count` cannot carry a filter, and the
        // filter is the whole question — a departed student is not somebody to prepare a lesson for.
        attendances: { where: { isActive: true }, select: { id: true } },
      },
    });
  }

  /**
   * The student's list: dated classes of the courses they hold a place in, with their own line on
   * each.
   *
   * The relationship is read through the place rather than through the register, which is what lets
   * a student who enrolled five minutes ago see the term they just joined — the register beside that
   * class is written by the next sweep, and a calendar that waited an hour for a clock would look
   * broken to the person who is now in the course.
   */
  async listLearning(studentUserId: string, from: Date, to: Date) {
    return this.prisma.classOccurrence.findMany({
      where: {
        isActive: true,
        startsAt: { gte: from, lt: to },
        course: { enrollments: { some: { studentUserId, isActive: true } } },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        course: { select: { id: true, slug: true, title: true } },
        attendances: {
          where: { studentUserId },
          select: { status: { select: { code: true } } },
        },
      },
    });
  }
}
