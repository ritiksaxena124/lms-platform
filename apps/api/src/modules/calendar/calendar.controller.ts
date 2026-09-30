import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import type {
  ClassSeriesListResponse,
  ClassSeriesResponse,
  HolidayListResponse,
  HolidayResponse,
} from '@lms/shared';
import { ROLE_CODES } from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { CalendarService } from './calendar.service';
import { CreateClassSeriesDto, UpdateClassSeriesDto } from './dto/class-series.dto';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

/**
 * A teacher's recurring calendar: the weekly series that auto-enroll students, and the holidays
 * that stop minutes from being offered at all.
 *
 * Series are owned by a course rather than the account — a teacher schedules one course's rhythm
 * separately from another's, and both may run on Monday at 09:00 without colliding. Holidays are
 * personal to the teacher: one teacher's festival is another teacher's working day.
 *
 * `@Roles(TEACHER)` covers all routes. A student reading a teacher's series would be reading a
 * schedule they cannot yet book against — the instances these mint are for enrolled students only.
 */
@Controller('courses/:courseId/series')
@Roles(ROLE_CODES.TEACHER)
export class ClassSeriesController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  async list(@Param('courseId') courseId: string): Promise<ClassSeriesListResponse> {
    return this.calendar.listSeries(courseId);
  }

  @Post()
  async create(
    @Param('courseId') courseId: string,
    @Body() dto: CreateClassSeriesDto,
  ): Promise<ClassSeriesResponse> {
    return this.calendar.createSeries(courseId, dto);
  }

  @Patch(':id')
  async update(
    @Param('courseId') courseId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClassSeriesDto,
  ): Promise<ClassSeriesResponse> {
    return this.calendar.updateSeries(courseId, id, dto);
  }

  /** Retirement is its own endpoint so an edit cannot smuggle in a flag change beside new times. */
  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  async retire(
    @Param('courseId') courseId: string,
    @Param('id') id: string,
  ): Promise<ClassSeriesResponse> {
    return this.calendar.retireSeries(courseId, id);
  }
}

/**
 * The days a teacher does not teach.
 *
 * Owned by the account because a holiday is personal — Diwali falls on the same date for every
 * teacher, but whether it stops classes is the teacher's decision. Recurring annually means this
 * date is blocked every year; a one-off blocks only the stated year.
 */
@Controller('availability/holidays')
@Roles(ROLE_CODES.TEACHER)
export class HolidayController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<HolidayListResponse> {
    return this.calendar.listHolidays(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHolidayDto,
  ): Promise<HolidayResponse> {
    return this.calendar.createHoliday(user.id, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateHolidayDto,
  ): Promise<HolidayResponse> {
    return this.calendar.updateHoliday(user.id, id, dto);
  }

  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  async retire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<HolidayResponse> {
    return this.calendar.retireHoliday(user.id, id);
  }
}
