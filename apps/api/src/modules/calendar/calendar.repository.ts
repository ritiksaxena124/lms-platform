import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export type ClassSeriesRow = Prisma.ClassSeriesGetPayload<{ include: { course: true } }>;
export type HolidayRow = Prisma.HolidayGetPayload<object>;

/** The three numbers that place one class in a week. The class length is not here because no
 * read asks about it — a window is where a teacher is standing, and that is what collides. */
export interface SeriesWindow {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
}

/**
 * The tables behind a teacher's recurring calendar.
 *
 * Every read and write carries ownership in its `where` clause — series through the course's
 * teacher, holidays through the account directly. Another teacher's schedule is the same
 * non-row as a uuid nobody wrote.
 */
@Injectable()
export class CalendarRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** All active series for one course, ordered by day then start time. */
  async listSeriesForCourse(courseId: string): Promise<ClassSeriesRow[]> {
    return this.prisma.classSeries.findMany({
      where: { courseId, isActive: true },
      orderBy: [{ weekday: 'asc' }, { startMinutes: 'asc' }],
      include: { course: true },
    });
  }

  /**
   * The course a series is about to be written on, only when this teacher owns it.
   *
   * A series used to be read as a note on a course — a thing whose only effect was on the course's
   * own screens. Since §2c it decides what a person's calendar holds on a Tuesday, which makes "is
   * this your course" a question the write has to ask rather than a convention the portal keeps.
   */
  async findCourseOwned(courseId: string, teacherUserId: string): Promise<{ id: string } | null> {
    return this.prisma.course.findFirst({
      where: { id: courseId, teacherUserId },
      select: { id: true },
    });
  }

  /** One series owned by this course. */
  async findSeriesOwned(courseId: string, id: string): Promise<ClassSeriesRow | null> {
    return this.prisma.classSeries.findFirst({
      where: { id, courseId },
      include: { course: true },
    });
  }

  /**
   * A standing class of this teacher's that covers any of these minutes on this day.
   *
   * Half-open, which is what makes Monday 09:00–10:00 and 10:00–11:00 two classes rather than a
   * collision — the same arithmetic §13's windows already follow. And the search runs across the
   * teacher's courses, not inside one: the thing that has to be in both rooms is the account, so
   * Algebra at 09:00–10:30 and Verbs at 10:00–11:00 is one person booked into two places, whatever
   * the courses say. A closed course is excluded because the generator excludes it too, and a
   * series on it puts no dated class on anybody's calendar.
   */
  async findTeacherClash(
    teacherUserId: string,
    window: SeriesWindow,
    exceptId?: string,
  ): Promise<ClassSeriesRow | null> {
    return this.prisma.classSeries.findFirst({
      where: {
        isActive: true,
        course: { teacherUserId, isActive: true },
        weekday: window.weekday,
        startMinutes: { lt: window.endMinutes },
        endMinutes: { gt: window.startMinutes },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      include: { course: true },
    });
  }

  /** The retired series sitting on this opening minute for this course, if there is one. The
   * business key is unique among retired rows as well as standing ones, so a class written again
   * at a minute this course has used before is that row reopened, not a twin beside it. */
  async findRetiredSeriesAt(
    courseId: string,
    weekday: number,
    startMinutes: number,
  ): Promise<ClassSeriesRow | null> {
    const row = await this.prisma.classSeries.findUnique({
      where: { courseId_weekday_startMinutes: { courseId, weekday, startMinutes } },
      include: { course: true },
    });
    return row && !row.isActive ? row : null;
  }

  /** All holidays for one teacher, newest first. */
  async listHolidays(teacherUserId: string): Promise<HolidayRow[]> {
    return this.prisma.holiday.findMany({
      where: { teacherUserId, isActive: true },
      orderBy: { date: 'desc' },
    });
  }

  /** One holiday owned by this teacher. */
  async findHolidayOwned(teacherUserId: string, id: string): Promise<HolidayRow | null> {
    return this.prisma.holiday.findFirst({ where: { id, teacherUserId } });
  }

  /** Check if a holiday already exists on this date for this teacher. */
  async findHolidayOnDate(
    teacherUserId: string,
    date: string,
    exceptId?: string,
  ): Promise<HolidayRow | null> {
    return this.prisma.holiday.findFirst({
      where: {
        teacherUserId,
        date,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
  }
}
