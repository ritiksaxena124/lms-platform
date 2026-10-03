import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSION_CODES, type Course, type CourseChoice } from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { CoursesService } from './courses.service';
// Value imports: the validation pipe finds a DTO through emitted parameter metadata, and
// an erased class would leave every body unchecked.
import { CreateCourseDto, DemoBookingsDto, UpdateCourseDto } from './dto/course.dto';
import { ListCoursesQueryDto } from './dto/list-courses-query.dto';

/**
 * A teacher's own courses. The id in the address is a lookup key, never a permission —
 * `CoursesService` answers for whoever the session belongs to, and a course that is not
 * theirs does not exist here.
 */
@Controller('courses')
@Permissions(PERMISSION_CODES.COURSE_AUTHOR)
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCoursesQueryDto,
  ): Promise<{ items: Course[] }> {
    return { items: await this.courses.list(user.id, query.status) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCourseDto,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.create(user.id, dto) };
  }

  /** Declared before `:id`, because a route that reads like an id is the one case where
   * ordering is the whole difference between a list of levels and a 404. */
  @Get('levels')
  async levels(): Promise<{ items: CourseChoice[] }> {
    return { items: await this.courses.levels() };
  }

  /** The currencies a price can be quoted in, for the same reason the levels are here: the
   * amount box needs a unit beside it, and the unit list is a lookup's business. */
  @Get('currencies')
  async currencies(): Promise<{ items: CourseChoice[] }> {
    return { items: await this.courses.currencies() };
  }

  @Get(':id')
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.read(user.id, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.update(user.id, id, dto) };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.publish(user.id, id) };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.archive(user.id, id) };
  }

  /**
   * Take a live course back to a draft.
   *
   * Its own verb rather than a field on `PATCH :id` for the reason `publish` is: the edit form is
   * closed while a course is on the shelf, so the only way to reach the fields is to come off it,
   * and a body that could write `status` would let any form publish by accident.
   */
  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.unpublish(user.id, id) };
  }

  /** File an archive away again, as a draft rather than onto the shelf. */
  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  async unarchive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.unarchive(user.id, id) };
  }

  /**
   * Open or close the course to a trial call from a student who has not taken a place.
   *
   * A route rather than a field on `PATCH :id`, because the edit form is closed once a course is
   * published and this is the one decision a teacher most often makes about a course that is
   * already live. `POST` on an address that reads as a switch, with the word in the body, so
   * opening and closing are the same call with the same answer shape.
   */
  @Post(':id/demo-bookings')
  @HttpCode(HttpStatus.OK)
  async setDemoBookings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DemoBookingsDto,
  ): Promise<{ course: Course }> {
    return { course: await this.courses.setDemoBookings(user.id, id, dto.enabled) };
  }
}
