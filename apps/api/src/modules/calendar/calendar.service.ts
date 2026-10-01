import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClassSeriesListResponse, ClassSeriesResponse, HolidayListResponse, HolidayResponse } from '@lms/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CalendarRepository } from './calendar.repository';
import type { CreateClassSeriesDto, UpdateClassSeriesDto } from './dto/class-series.dto';
import type { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

/**
 * The recurring calendar behind a teacher's week.
 *
 * A series is a plan for one course — Monday at 09:00–10:00, Thursday at 14:00–15:00 — and the
 * booking endpoint will auto-enroll students into every instance. A holiday is a day nobody
 * teaches: a festival, a personal day off. Both are edits to what §13's windows mean.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CalendarRepository,
  ) {}

  /** Every active series for one course. */
  async listSeries(courseId: string): Promise<ClassSeriesListResponse> {
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

  /** Add a new weekly slot to this course. */
  async createSeries(
    courseId: string,
    dto: CreateClassSeriesDto,
  ): Promise<ClassSeriesResponse> {
    const overlap = await this.repo.findSeriesOverlap(courseId, dto.weekday, dto.startMinutes);
    if (overlap) {
      throw new ConflictException('A series already exists at this time for this course.');
    }

    if (dto.endMinutes <= dto.startMinutes) {
      throw new ConflictException('The window must end after it starts.');
    }

    if (dto.durationMinutes > dto.endMinutes - dto.startMinutes) {
      throw new ConflictException('The class does not fit inside the window.');
    }

    const series = await this.prisma.classSeries.create({
      data: {
        courseId,
        weekday: dto.weekday,
        startMinutes: dto.startMinutes,
        endMinutes: dto.endMinutes,
        durationMinutes: dto.durationMinutes,
      },
    });

    const withCourse = await this.repo.findSeriesOwned(courseId, series.id);
    if (!withCourse) throw new NotFoundException('Series not found after creation.');

    return { series: this.toSeriesResponse(withCourse) };
  }

  /** Adjust an existing series. */
  async updateSeries(
    courseId: string,
    id: string,
    dto: UpdateClassSeriesDto,
  ): Promise<ClassSeriesResponse> {
    const existing = await this.repo.findSeriesOwned(courseId, id);
    if (!existing) {
      throw new NotFoundException('This series does not belong to this course.');
    }

    const weekday = dto.weekday ?? existing.weekday;
    const startMinutes = dto.startMinutes ?? existing.startMinutes;
    const endMinutes = dto.endMinutes ?? existing.endMinutes;
    const durationMinutes = dto.durationMinutes ?? existing.durationMinutes;

    if (endMinutes <= startMinutes) {
      throw new ConflictException('The window must end after it starts.');
    }

    if (durationMinutes > endMinutes - startMinutes) {
      throw new ConflictException('The class does not fit inside the window.');
    }

    const overlap = await this.repo.findSeriesOverlap(courseId, weekday, startMinutes, id);
    if (overlap) {
      throw new ConflictException('Another series already exists at this time for this course.');
    }

    await this.prisma.classSeries.update({
      where: { id },
      data: { weekday, startMinutes, endMinutes, durationMinutes },
    });

    const withCourse = await this.repo.findSeriesOwned(courseId, id);
    if (!withCourse) throw new NotFoundException('Series not found after update.');

    return { series: this.toSeriesResponse(withCourse) };
  }

  /** Retire a series so it stops generating instances. */
  async retireSeries(courseId: string, id: string): Promise<ClassSeriesResponse> {
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

  /** Add a day this teacher does not teach. */
  async createHoliday(
    teacherUserId: string,
    dto: CreateHolidayDto,
  ): Promise<HolidayResponse> {
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

    return { holiday: this.toHolidayResponse(holiday) };
  }

  /** Adjust an existing holiday. */
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

    return { holiday: this.toHolidayResponse(updated) };
  }

  /** Retire a holiday so it no longer blocks slots. */
  async retireHoliday(teacherUserId: string, id: string): Promise<HolidayResponse> {
    const existing = await this.repo.findHolidayOwned(teacherUserId, id);
    if (!existing) {
      throw new NotFoundException('This holiday does not belong to you.');
    }

    const retired = await this.prisma.holiday.update({
      where: { id },
      data: { isActive: false },
    });

    return { holiday: this.toHolidayResponse(retired) };
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
