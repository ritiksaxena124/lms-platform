import { Type } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * The class a student is asking for: a course and one of its offered minutes.
 *
 * Two fields, because everything else about a booking belongs to somebody else. A status would
 * let the student confirm their own request; a type would let them claim a demo they are not
 * entitled to, or an enrolled class they never enrolled in; a duration would let them book three
 * hours of a teacher out of a window that opens for one. All three are read from the tables that
 * own them instead — and the whitelist pipe refuses them rather than ignoring them, so a portal
 * that sends one finds out at once.
 *
 * `startsAt` is an instant, not a clock face. The calendar the student clicked was built by
 * expanding the teacher's rules in the teacher's zone, and the service matches the minute against
 * that same arithmetic, so what the portal offered is exactly what the API can take.
 */
export class CreateBookingDto {
  @Type(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  course!: string;

  @Type(() => String)
  @IsISO8601({}, { message: 'Pick a class from the calendar.' })
  startsAt!: string;
}
