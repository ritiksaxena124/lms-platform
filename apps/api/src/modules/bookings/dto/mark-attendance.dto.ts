import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

import { BOOKING_MARK_CODES, type BookingMarkCode } from '@lms/shared';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The one word a teacher picks for a class that has gone by: it happened, or it did not.
 *
 * Two words and no others, because the rest of the booking vocabulary belongs to somebody else.
 * `pending` is what a request is before the teacher speaks, not an answer they give. `confirmed`
 * and `rejected` already have their own two routes, which is where a class is decided *before* it
 * is due. `cancelled` is the student's word for their own class, and `expired` is the clock's — a
 * route that could write either would let a teacher mark a class off on a student's behalf, or
 * claim credit for a sweep.
 *
 * A `BookingStatusCode` rather than a new register, because a one-to-one has no roll to fill: it
 * has one name, and that name is the class. So its attendance is the booking's own state, and the
 * two endings were seeded for exactly this row four phases ago.
 */
export class MarkAttendanceDto {
  @Transform(trimmed)
  @IsIn([BOOKING_MARK_CODES.COMPLETED, BOOKING_MARK_CODES.NO_SHOW], {
    message: 'A class either happened or it did not.',
  })
  status!: BookingMarkCode;
}
