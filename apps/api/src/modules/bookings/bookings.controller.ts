import { Controller, Get, Query } from '@nestjs/common';
import { ROLE_CODES, type OpenSlotsResponse } from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { BookingsService } from './bookings.service';
import { OpenSlotsQueryDto } from './dto/open-slots-query.dto';

/**
 * A student's side of the calendar: the class times a course is offering them.
 *
 * The route is a read of an *offer*, not of a booking, and it is addressed by course rather than
 * by teacher. A teacher is free at a hundred instants across a term; what a student can act on is
 * the subset of those their relationship to one course opens, which is why the entitlement is
 * decided here rather than on a screen that would have to be told the rules to apply them.
 *
 * `@Roles(STUDENT)` on this handler rather than the controller, because the teacher's own routes —
 * the requests waiting for an answer, and the answer — are the same table read from the other
 * side, and they belong to a different door.
 */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('slots')
  @Roles(ROLE_CODES.STUDENT)
  async slots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OpenSlotsQueryDto,
  ): Promise<OpenSlotsResponse> {
    return this.bookings.openSlots(user.id, query.course);
  }
}
