import { IsString, Length, IsOptional } from 'class-validator';

/**
 * The whole of what it takes to take a place: which course, and optionally a discount code.
 *
 * There is no student field, because the session is the student — a body that could name
 * somebody else would be a way to enroll a person in their absence. And there is no "as of"
 * date, no note, no intended start: those are booking decisions, and a place in a course is
 * not an appointment.
 *
 * `courseId` is a string rather than `@IsUUID` because the address is the caller's guess at
 * a thing we may or may not have. A shape that cannot be a uuid and a uuid that was never
 * written are the same non-course, and the endpoint says so the way the catalog does.
 *
 * `couponCode` is optional — when present, the enrollment calculates the discounted price
 * and records a payment row linking the enrollment to the coupon used.
 */
export class EnrollDto {
  @IsString()
  @Length(1, 120)
  courseId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  couponCode?: string;
}
