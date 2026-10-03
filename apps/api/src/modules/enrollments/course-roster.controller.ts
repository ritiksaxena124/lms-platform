import { Controller, Get, Param, Query } from '@nestjs/common';
import { PERMISSION_CODES, type CourseRosterResponse } from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { EnrollmentsService } from './enrollments.service';
// Value import: the validation pipe finds a DTO through emitted parameter metadata, and an
// erased class would leave every query unchecked.
import { ListRosterQueryDto } from './dto/list-roster-query.dto';

/**
 * A teacher's class list: who holds a place in a course they wrote.
 *
 * The address is a course's rather than a roster's of its own, which is the shape every other
 * teacher route takes — a nested list the caller must already own the parent of. The id is a
 * lookup key and never a permission: the service resolves it against the courses belonging to
 * this session, so another teacher's class and a uuid nobody wrote are one answer.
 *
 * `@Permissions(ROSTER_READ)` keeps a student out of it at the door. The route is not secret from
 * them so much as it is not *theirs*: a student reading a roster would be a list of other people's
 * enrollments, which §12 says is a relationship between one student and one course.
 */
@Controller('courses/:courseId/roster')
@Permissions(PERMISSION_CODES.ROSTER_READ)
export class CourseRosterController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Query() query: ListRosterQueryDto,
  ): Promise<CourseRosterResponse> {
    return this.enrollments.roster(user.id, courseId, query);
  }
}
