import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * A day this teacher does not teach.
 *
 * Stored as an ISO 8601 date string rather than a timestamp, because the whole day is blocked
 * and the zone decides when midnight is. The reason is optional — some days need no explanation.
 */
export class CreateHolidayDto {
  @IsDateString({}, { message: 'Give the date as YYYY-MM-DD.' })
  date!: string;

  @IsOptional()
  @IsString({ message: 'A reason is text.' })
  reason?: string;

  @IsOptional()
  @IsBoolean({ message: 'Recurring annually is yes or no.' })
  isRecurringAnnual?: boolean;
}

/**
 * A holiday the teacher is adjusting.
 *
 * `isActive` is deliberately absent: retirement is its own endpoint, so an edit that could clear
 * the flag would be a way to close a holiday while pretending to re-date it.
 */
export class UpdateHolidayDto {
  @IsOptional()
  @IsDateString({}, { message: 'Give the date as YYYY-MM-DD.' })
  date?: string;

  @IsOptional()
  @IsString({ message: 'A reason is text.' })
  reason?: string;

  @IsOptional()
  @IsBoolean({ message: 'Recurring annually is yes or no.' })
  isRecurringAnnual?: boolean;
}
