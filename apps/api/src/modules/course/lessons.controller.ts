import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ROLE_CODES, type LessonListResponse, type LessonResponse } from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { LessonsService } from './lessons.service';
// Value imports: the validation pipe finds a DTO through emitted parameter metadata, and
// an erased class would leave every body unchecked.
import { CreateLessonDto, ReorderLessonsDto, UpdateLessonDto } from './dto/lesson.dto';

/**
 * One module's lessons, addressed through the module.
 *
 * Two path parameters instead of a lesson id of its own: the syllabus is ordered inside a
 * block, and the route that names both is the one that cannot be pointed at someone else's
 * page by accident. The `moduleId` is not a permission — the service resolves it against the
 * courses the session owns, so another teacher's module answers `NOT_FOUND` here exactly as
 * their course does on `/courses`.
 */
@Controller('modules/:moduleId/lessons')
@Roles(ROLE_CODES.TEACHER)
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
  ): Promise<LessonListResponse> {
    return { items: await this.lessons.list(user.id, moduleId) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Body() dto: CreateLessonDto,
  ): Promise<LessonResponse> {
    return { lesson: await this.lessons.create(user.id, moduleId, dto) };
  }

  /** Declared before `:id`, because a path that could read as an id is the one case where
   * ordering is the whole difference between a reorder and an edit of nothing. */
  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Body() dto: ReorderLessonsDto,
  ): Promise<LessonListResponse> {
    return { items: await this.lessons.reorder(user.id, moduleId, dto.lessonIds) };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Param('id') id: string,
  ): Promise<LessonResponse> {
    return { lesson: await this.lessons.publish(user.id, moduleId, id) };
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Param('id') id: string,
  ): Promise<LessonResponse> {
    return { lesson: await this.lessons.unpublish(user.id, moduleId, id) };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Param('id') id: string,
  ): Promise<LessonResponse> {
    return { lesson: await this.lessons.deactivate(user.id, moduleId, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moduleId') moduleId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLessonDto,
  ): Promise<LessonResponse> {
    return { lesson: await this.lessons.update(user.id, moduleId, id, dto) };
  }
}
