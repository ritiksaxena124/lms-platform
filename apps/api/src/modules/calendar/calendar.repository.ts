import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export type ClassSeriesRow = Prisma.ClassSeriesGetPayload<{ include: { course: true } }>;
export type HolidayRow = Prisma.HolidayGetPayload<object>;

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

  /** Check if another series exists at this slot for the same course. */
  async findSeriesOverlap(
    courseId: string,
    weekday: number,
    startMinutes: number,
    exceptId?: string,
  ): Promise<ClassSeriesRow | null> {
    return this.prisma.classSeries.findFirst({
      where: {
        courseId,
        isActive: true,
        weekday,
        startMinutes,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      include: { course: true },
    });
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
