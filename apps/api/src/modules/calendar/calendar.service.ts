import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ClassSeriesListResponse,
  ClassSeriesResponse,
  HolidayListResponse,
  HolidayResponse,
} from '@lms/shared';
import { weekdayLabel, wallClock } from '@lms/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CalendarRepository, type ClassSeriesRow, type SeriesWindow } from './calendar.repository';
import { ClassOccurrenceService } from './class-occurrence.service';
import type { CreateClassSeriesDto, UpdateClassSeriesDto } from './dto/class-series.dto';
import type { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

/**
 * The recurring calendar behind a teacher's week.
 *
 * A series is a plan for one course — Monday at 09:00–10:00, Thursday at 14:00–15:00 — and a
 * holiday is a day nobody teaches: a festival, a personal day off. Both are edits to what §13's
 * windows mean, and neither touches the booking table, which runs on its own availability rules.
 *
 * Both are also, since §2c, edits to a dated calendar. A teacher who changes a pattern has changed
 * what next Tuesday holds, so every write here hands the row to `ClassOccurrenceService` to
 * reconcile the horizon it governs before the answer goes back. That is not the sweep running
 * twice over; it is the sweep running *now* rather than on the next hour, because a teacher who
 * has just edited their week is looking at the screen that shows it.
 */
/**
 * A class this teacher is already standing for, sitting in the way of the one being written.
 *
 * Named by its day, its span and its course, because a teacher who runs four courses through a
 * Monday needs to be told which one they just walked into — and the rule is said alongside the
 * refusal, so the fix (open this class when that one closes) is readable without a search.
 */
function taken(held: ClassSeriesRow): ConflictException {
  const span = `${weekdayLabel(held.weekday)} ${wallClock(held.startMinutes)}–${wallClock(
    held.endMinutes,
  )}`;
  return new ConflictException(
    `${span} is already taken by ${held.course.title}. A class may open the minute that one closes; no two of yours cover the same minutes.`,
  );
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CalendarRepository,
    private readonly occurrences: ClassOccurrenceService,
  ) {}

  /** Every active series for one course. */
  async listSeries(teacherUserId: string, courseId: string): Promise<ClassSeriesListResponse> {
    await this.requireOwnCourse(teacherUserId, courseId);
    const items = await this.repo.listSeriesForCourse(courseId);
    return {
      items: items.map((s) => ({
        id: s.id,
        courseId: s.courseId,
        weekday: s.weekday,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        durationMinutes: s.durationMinutes,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }

  /** Add a new weekly slot to this course, and open the classes it stands for. */
  async createSeries(
    teacherUserId: string,
    courseId: string,
    dto: CreateClassSeriesDto,
  ): Promise<ClassSeriesResponse> {
    await this.requireOwnCourse(teacherUserId, courseId);

    const window: SeriesWindow = {
      weekday: dto.weekday,
      startMinutes: dto.startMinutes,
      endMinutes: dto.endMinutes,
    };

    // The shape is settled before the calendar is read, because a window that closes before it
    // opens covers no minutes at all and cannot be compared against anything.
    if (dto.endMinutes <= dto.startMinutes) {
      throw new ConflictException('The window must end after it starts.');
    }

    if (dto.durationMinutes > dto.endMinutes - dto.startMinutes) {
      throw new ConflictException('The class does not fit inside the window.');
    }

    await this.requireFree(teacherUserId, window);

    // The opening minute may already be on this course from a term it retired. That row is brought
    // back rather than written a twin, because the business key is unique among retired rows too
    // and a second statement on it would answer as a database error.
    const retired = await this.repo.findRetiredSeriesAt(
      courseId,
      window.weekday,
      window.startMinutes,
    );

    let series;
    try {
      series = retired
        ? await this.prisma.classSeries.update({
            where: { id: retired.id },
            data: {
              endMinutes: dto.endMinutes,
              durationMinutes: dto.durationMinutes,
              isActive: true,
            },
          })
        : await this.prisma.classSeries.create({
            data: { courseId, ...window, durationMinutes: dto.durationMinutes },
          });
    } catch (error) {
      throw this.orTakenOnTheMinute(teacherUserId, courseId, error, window);
    }

    const withCourse = await this.repo.findSeriesOwned(courseId, series.id);
    if (!withCourse) throw new NotFoundException('Series not found after creation.');

    await this.occurrences.reconcileTeacher(teacherUserId, new Date());

    return { series: this.toSeriesResponse(withCourse) };
  }

  /** Adjust an existing series, and move the classes it no longer stands for. */
  async updateSeries(
    teacherUserId: string,
    courseId: string,
    id: string,
    dto: UpdateClassSeriesDto,
  ): Promise<ClassSeriesResponse> {
    await this.requireOwnCourse(teacherUserId, courseId);

    const existing = await this.repo.findSeriesOwned(courseId, id);
    if (!existing) {
      throw new NotFoundException('This series does not belong to this course.');
    }

    const weekday = dto.weekday ?? existing.weekday;
    const startMinutes = dto.startMinutes ?? existing.startMinutes;
    const endMinutes = dto.endMinutes ?? existing.endMinutes;
    const durationMinutes = dto.durationMinutes ?? existing.durationMinutes;

    const window: SeriesWindow = { weekday, startMinutes, endMinutes };

    if (endMinutes <= startMinutes) {
      throw new ConflictException('The window must end after it starts.');
    }

    if (durationMinutes > endMinutes - startMinutes) {
      throw new ConflictException('The class does not fit inside the window.');
    }

    // Compared against everything except itself, or a teacher could never press Save on a class
    // they had not moved.
    await this.requireFree(teacherUserId, window, id);

    try {
      await this.prisma.classSeries.update({
        where: { id },
        data: { ...window, durationMinutes },
      });
    } catch (error) {
      throw this.orTakenOnTheMinute(teacherUserId, courseId, error, window);
    }

    const withCourse = await this.repo.findSeriesOwned(courseId, id);
    if (!withCourse) throw new NotFoundException('Series not found after update.');

    await this.occurrences.reconcileTeacher(teacherUserId, new Date());

    return { series: this.toSeriesResponse(withCourse) };
  }

  /** Retire a series so it stops standing for classes, and close the ones it made. */
  async retireSeries(
    teacherUserId: string,
    courseId: string,
    id: string,
  ): Promise<ClassSeriesResponse> {
    await this.requireOwnCourse(teacherUserId, courseId);

    const existing = await this.repo.findSeriesOwned(courseId, id);
    if (!existing) {
      throw new NotFoundException('This series does not belong to this course.');
    }

    await this.prisma.classSeries.update({
      where: { id },
      data: { isActive: false },
    });

    const withCourse = await this.repo.findSeriesOwned(courseId, id);
    if (!withCourse) throw new NotFoundException('Series not found after retirement.');

    await this.occurrences.reconcileTeacher(teacherUserId, new Date());

    return { series: this.toSeriesResponse(withCourse) };
  }

  /** All holidays for one teacher. */
  async listHolidays(teacherUserId: string): Promise<HolidayListResponse> {
    const items = await this.repo.listHolidays(teacherUserId);
    return {
      items: items.map((h) => ({
        id: h.id,
        teacherUserId: h.teacherUserId,
        date: h.date,
        reason: h.reason,
        isRecurringAnnual: h.isRecurringAnnual,
        isActive: h.isActive,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      })),
    };
  }

  /** Add a day this teacher does not teach, and take that day off their calendar. */
  async createHoliday(teacherUserId: string, dto: CreateHolidayDto): Promise<HolidayResponse> {
    const existing = await this.repo.findHolidayOnDate(teacherUserId, dto.date);
    if (existing) {
      throw new ConflictException('A holiday already exists on this date.');
    }

    const holiday = await this.prisma.holiday.create({
      data: {
        teacherUserId,
        date: dto.date,
        reason: dto.reason ?? null,
        isRecurringAnnual: dto.isRecurringAnnual ?? false,
      },
    });

    await this.occurrences.reconcileTeacher(teacherUserId, new Date());

    return { holiday: this.toHolidayResponse(holiday) };
  }

  /** Move an existing holiday, and re-open the day it used to block. */
  async updateHoliday(
    teacherUserId: string,
    id: string,
    dto: UpdateHolidayDto,
  ): Promise<HolidayResponse> {
    const existing = await this.repo.findHolidayOwned(teacherUserId, id);
    if (!existing) {
      throw new NotFoundException('This holiday does not belong to you.');
    }

    const date = dto.date ?? existing.date;
    const reason = dto.reason ?? existing.reason;
    const isRecurringAnnual = dto.isRecurringAnnual ?? existing.isRecurringAnnual;

    if (date !== existing.date) {
      const overlap = await this.repo.findHolidayOnDate(teacherUserId, date, id);
      if (overlap) {
        throw new ConflictException('Another holiday already exists on this date.');
      }
    }

    const updated = await this.prisma.holiday.update({
      where: { id },
      data: { date, reason, isRecurringAnnual },
    });

    await this.occurrences.reconcileTeacher(teacherUserId, new Date());

    return { holiday: this.toHolidayResponse(updated) };
  }

  /** Lift a holiday so the day it blocked is taught again. */
  async retireHoliday(teacherUserId: string, id: string): Promise<HolidayResponse> {
    const existing = await this.repo.findHolidayOwned(teacherUserId, id);
    if (!existing) {
      throw new NotFoundException('This holiday does not belong to you.');
    }

    const retired = await this.prisma.holiday.update({
      where: { id },
      data: { isActive: false },
    });

    await this.occurrences.reconcileTeacher(teacherUserId, new Date());

    return { holiday: this.toHolidayResponse(retired) };
  }

  /**
   * Refuse a series written on a course the caller does not own.
   *
   * The route has always asked for the scheduling capability, which says the caller runs a
   * timetable but not *this* one. While a series only fed its own course's screens that was a small
   * leak; since §2c a series is what puts dated classes on a named teacher's month, and a teacher who
   * could schedule somebody else's course could fill their calendar with classes they never agreed to
   * teach.
   */
  private async requireOwnCourse(teacherUserId: string, courseId: string): Promise<void> {
    const course = await this.repo.findCourseOwned(courseId, teacherUserId);
    if (!course) {
      throw new NotFoundException('No course here is yours to schedule.');
    }
  }

  /** No class this teacher is already standing for may cover any minute of this window. A class
   * may touch another at the edge — 09:00–10:00 and 10:00–11:00 are a timetable, not a collision. */
  private async requireFree(
    teacherUserId: string,
    window: SeriesWindow,
    exceptId?: string,
  ): Promise<void> {
    const held = await this.repo.findTeacherClash(teacherUserId, window, exceptId);
    if (held) throw taken(held);
  }

  /**
   * The database refused a write the checks above allowed, or the checks were right.
   *
   * Two tabs saving the same class both pass `requireFree`, and the business key is what catches
   * the second one; an edit can also land on a minute this course used in a retired term, which no
   * standing-overlap read can see. Either way the teacher gets the answer the check would have
   * given rather than a stack trace about an index. Anything that is not a unique violation is
   * still a bug and goes back unchanged.
   */
  private async orTakenOnTheMinute(
    teacherUserId: string,
    courseId: string,
    error: unknown,
    window: SeriesWindow,
  ): Promise<unknown> {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return error;
    }

    const held =
      (await this.repo.findTeacherClash(teacherUserId, window)) ??
      (await this.repo.findRetiredSeriesAt(courseId, window.weekday, window.startMinutes));

    return held ? taken(held) : error;
  }

  private toSeriesResponse(series: {
    id: string;
    courseId: string;
    weekday: number;
    startMinutes: number;
    endMinutes: number;
    durationMinutes: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: series.id,
      courseId: series.courseId,
      weekday: series.weekday,
      startMinutes: series.startMinutes,
      endMinutes: series.endMinutes,
      durationMinutes: series.durationMinutes,
      isActive: series.isActive,
      createdAt: series.createdAt.toISOString(),
      updatedAt: series.updatedAt.toISOString(),
    };
  }

  private toHolidayResponse(holiday: {
    id: string;
    teacherUserId: string;
    date: string;
    reason: string | null;
    isRecurringAnnual: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: holiday.id,
      teacherUserId: holiday.teacherUserId,
      date: holiday.date,
      reason: holiday.reason,
      isRecurringAnnual: holiday.isRecurringAnnual,
      isActive: holiday.isActive,
      createdAt: holiday.createdAt.toISOString(),
      updatedAt: holiday.updatedAt.toISOString(),
    };
  }
}
