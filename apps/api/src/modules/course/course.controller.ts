import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ROLE_CODES } from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { CourseDocument } from './courses.service';
import { CoursesService } from './courses.service';
// Value imports: the validation pipe finds a DTO through emitted parameter metadata, and
// an erased class would leave every body unchecked.
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';
import { ListCoursesQueryDto } from './dto/list-courses-query.dto';

/**
 * A teacher's own courses. The id in the address is a lookup key, never a permission —
 * `CoursesService` answers for whoever the session belongs to, and a course that is not
 * theirs does not exist here.
 */
@Controller('courses')
@Roles(ROLE_CODES.TEACHER)
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCoursesQueryDto,
  ): Promise<{ items: CourseDocument[] }> {
    return { items: await this.courses.list(user.id, query.status) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCourseDto,
  ): Promise<{ course: CourseDocument }> {
    return { course: await this.courses.create(user.id, dto) };
  }

  @Get(':id')
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: CourseDocument }> {
    return { course: await this.courses.read(user.id, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
  ): Promise<{ course: CourseDocument }> {
    return { course: await this.courses.update(user.id, id, dto) };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: CourseDocument }> {
    return { course: await this.courses.publish(user.id, id) };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ course: CourseDocument }> {
    return { course: await this.courses.archive(user.id, id) };
  }
}
