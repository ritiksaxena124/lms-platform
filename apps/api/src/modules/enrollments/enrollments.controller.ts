import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ROLE_CODES,
  type EnrollmentListResponse,
  type EnrollmentResponse,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { EnrollmentsService } from './enrollments.service';
// Value import: the validation pipe finds a DTO through emitted parameter metadata, and an
// erased class would leave every body unchecked.
import { EnrollDto } from './dto/enroll.dto';

/**
 * A student's own places in other people's courses.
 *
 * `@Roles(STUDENT)` answers who may hold a place, which is why no handler here has to ask
 * whether the caller owns the course they are joining: a teacher cannot reach this route at
 * all. Ops is absent for the same reason it is absent from the sign-up form — an internal
 * account does not enroll.
 *
 * There is no `studentId` in any address or body. The session is the student, and every read
 * and write below is scoped by it, so a list cannot be widened to somebody else's places and
 * a cancel cannot reach a stranger's.
 */
@Controller('enrollments')
@Roles(ROLE_CODES.STUDENT)
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<EnrollmentListResponse> {
    return { items: await this.enrollments.list(user.id) };
  }

  /** `200` even the first time: taking a place twice is one place, and a client that had to
   * handle `201` and `200` differently would be branching on history it cannot know. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async enroll(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnrollDto,
  ): Promise<EnrollmentResponse> {
    return { enrollment: await this.enrollments.enroll(user.id, dto) };
  }

  /** The id here is the enrollment's, not the course's — the caller's own list sends it, and
   * leaving is a decision about a place one already holds rather than about a course. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<EnrollmentResponse> {
    return { enrollment: await this.enrollments.cancel(user.id, id) };
  }
}
