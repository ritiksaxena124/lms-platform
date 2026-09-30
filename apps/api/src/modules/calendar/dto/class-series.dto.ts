import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_END_MINUTES, MAX_SLOT_MINUTES, MAX_START_MINUTES, MAX_WEEKDAY, MIN_SLOT_MINUTES, MIN_START_MINUTES, MIN_WEEKDAY } from '@lms/shared';

const DAY = 'A week has seven days, and this one starts counting at Monday.';
const MINUTES = 'Give the time as minutes from midnight, local to you.';
const SLOT = `A class runs from ${MIN_SLOT_MINUTES} to ${MAX_SLOT_MINUTES} minutes.`;

/**
 * A recurring weekly slot a teacher schedules for one course.
 *
 * There is no teacher in the body: the session owns the course, and a body that could name
 * somebody else's course would be a way to write a colleague's schedule. The timezone is absent
 * because it lives on the account (§5).
 */
export class CreateClassSeriesDto {
  @IsInt({ message: DAY })
  @Min(MIN_WEEKDAY, { message: DAY })
  @Max(MAX_WEEKDAY, { message: DAY })
  weekday!: number;

  /** Midnight to one minute before it. A series that opens at midnight tomorrow would be a
   * series on next week's row, and the grid has no such thing. */
  @IsInt({ message: MINUTES })
  @Min(MIN_START_MINUTES, { message: MINUTES })
  @Max(MAX_START_MINUTES, { message: MINUTES })
  startMinutes!: number;

  @IsInt({ message: MINUTES })
  @Min(MIN_START_MINUTES + 1, { message: MINUTES })
  @Max(MAX_END_MINUTES, { message: MINUTES })
  endMinutes!: number;

  @IsInt({ message: SLOT })
  @Min(MIN_SLOT_MINUTES, { message: SLOT })
  @Max(MAX_SLOT_MINUTES, { message: SLOT })
  durationMinutes!: number;
}

/**
 * A series the teacher is adjusting.
 *
 * `isActive` is deliberately absent: retirement is its own endpoint, so an edit that could clear
 * the flag would be a way to close a series while pretending to re-time it.
 */
export class UpdateClassSeriesDto {
  @IsOptional()
  @IsInt({ message: DAY })
  @Min(MIN_WEEKDAY, { message: DAY })
  @Max(MAX_WEEKDAY, { message: DAY })
  weekday?: number;

  @IsOptional()
  @IsInt({ message: MINUTES })
  @Min(MIN_START_MINUTES, { message: MINUTES })
  @Max(MAX_START_MINUTES, { message: MINUTES })
  startMinutes?: number;

  @IsOptional()
  @IsInt({ message: MINUTES })
  @Min(MIN_START_MINUTES + 1, { message: MINUTES })
  @Max(MAX_END_MINUTES, { message: MINUTES })
  endMinutes?: number;

  @IsOptional()
  @IsInt({ message: SLOT })
  @Min(MIN_SLOT_MINUTES, { message: SLOT })
  @Max(MAX_SLOT_MINUTES, { message: SLOT })
  durationMinutes?: number;
}
