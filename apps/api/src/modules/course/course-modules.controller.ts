import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  PERMISSION_CODES,
  type CourseModuleListResponse,
  type CourseModuleResponse,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { CourseModulesService } from './course-modules.service';
// Value imports: the validation pipe finds a DTO through emitted parameter metadata, and
// an erased class would leave every body unchecked.
import {
  CreateCourseModuleDto,
  ReorderCourseModulesDto,
  UpdateCourseModuleDto,
} from './dto/course-module.dto';

/**
 * One course's syllabus, addressed through the course.
 *
 * The `courseId` in the address is not a permission — the service resolves it against the
 * session's own courses, which is why a module id alone is never a key and another teacher's
 * course answers `NOT_FOUND` here exactly as it does on `/courses`.
 */
@Controller('courses/:courseId/modules')
@Permissions(PERMISSION_CODES.COURSE_AUTHOR)
export class CourseModulesController {
  constructor(private readonly modules: CourseModulesService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
  ): Promise<CourseModuleListResponse> {
    return { items: await this.modules.list(user.id, courseId) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Body() dto: CreateCourseModuleDto,
  ): Promise<CourseModuleResponse> {
    return { module: await this.modules.create(user.id, courseId, dto) };
  }

  /** Declared before `:id`, because a path that could read as an id is the one case where
   * ordering is the whole difference between a reorder and a rename of nothing. */
  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Body() dto: ReorderCourseModulesDto,
  ): Promise<CourseModuleListResponse> {
    return { items: await this.modules.reorder(user.id, courseId, dto.moduleIds) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCourseModuleDto,
  ): Promise<CourseModuleResponse> {
    return { module: await this.modules.update(user.id, courseId, id, dto) };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Param('id') id: string,
  ): Promise<CourseModuleResponse> {
    return { module: await this.modules.deactivate(user.id, courseId, id) };
  }
}
