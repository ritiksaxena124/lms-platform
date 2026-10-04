import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  PERMISSION_CODES,
  type EnrollmentListResponse,
  type EnrollmentResponse,
  type PlaceResponse,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { EnrollmentsService } from './enrollments.service';
// Value import: the validation pipe finds a DTO through emitted parameter metadata, and an
// erased class would leave every body unchecked.
import { EnrollDto } from './dto/enroll.dto';

/**
 * A student's own places in other people's courses.
 *
 * `@Permissions(ENROLLMENT_HOLD)` answers who may hold a place, which is why no handler here has to ask
 * whether the caller owns the course they are joining: a teacher cannot reach this route at
 * all. Ops is absent for the same reason it is absent from the sign-up form — an internal
 * account does not enroll.
 *
 * There is no `studentId` in any address or body. The session is the student, and every read
 * and write below is scoped by it, so a list cannot be widened to somebody else's places and
 * a cancel cannot reach a stranger's.
 */
@Controller('enrollments')
@Permissions(PERMISSION_CODES.ENROLLMENT_HOLD)
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<EnrollmentListResponse> {
    return { items: await this.enrollments.list(user.id) };
  }

  /** `200` even the first time: taking a place twice is one place, and a client that had to
   * handle `201` and `200` differently would be branching on history it cannot know.
   *
   * The answer carries the payment beside the enrollment because a place that is closed and a place
   * that is waiting on money are the same `isActive: false`, and only the second half tells them
   * apart. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async enroll(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnrollDto,
  ): Promise<PlaceResponse> {
    return this.enrollments.enroll(user.id, dto);
  }

  /**
   * Answer for the money a held place owes.
   *
   * A press, not a checkout: there is no body, because the amount and the currency are what this
   * platform already wrote on the ledger row, and a body that could name a number would be a student
   * choosing their own price. The id is the enrollment's — the same one the enroll answer gave — so
   * the place being paid for is the caller's own and nothing else can be addressed here.
   *
   * Idempotent in the same direction as the enroll press: a second pay on a settled attempt reports
   * the attempt that completed rather than asking the gateway again, so a double click is one charge.
   * A refused charge replies `200` with a `failed` payment, because the place moved into a state and
   * the portal's job is to show it.
   */
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  async pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PlaceResponse> {
    return this.enrollments.pay(user.id, id);
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
