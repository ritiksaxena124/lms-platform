import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  MAX_END_MINUTES,
  MAX_SLOT_MINUTES,
  MAX_START_MINUTES,
  MAX_WEEKDAY,
  MIN_END_MINUTES,
  MIN_SLOT_MINUTES,
  MIN_START_MINUTES,
  MIN_WEEKDAY,
} from '@lms/shared';

// The two classes are this file twice over on purpose: a patch may name three of four fields and
// leave the rest alone, while a create with a hole in it is a window nobody asked for. A shared
// base would make one body answer to both promises.
//
// The bounds here are the shape of a number. Whether a window is *well-formed* — whether it ends
// after it starts, whether a class fits inside it, whether it lands on another one — is the
// service's decision, because those questions are about a set of rows and a DTO can only see one
// field at a time.

const DAY = 'A week has seven days, and this one starts counting at Monday.';
const MINUTES = 'Give the time as minutes from midnight, local to you.';
const SLOT = `A class runs from ${MIN_SLOT_MINUTES} to ${MAX_SLOT_MINUTES} minutes.`;

/**
 * A window the teacher is opening.
 *
 * There is no teacher in the body: the session is the teacher, and a body that could name
 * somebody else would be a way to write a colleague's week in their absence. There is no
 * timezone either — these minutes are already local, and the zone lives on the account (§5).
 */
export class CreateAvailabilityRuleDto {
  @IsInt({ message: DAY })
  @Min(MIN_WEEKDAY, { message: DAY })
  @Max(MAX_WEEKDAY, { message: DAY })
  weekday!: number;

  /** Midnight to one minute before it. A window that opened at midnight tomorrow would be a
   * window on next week's row, and the grid has no such thing. */
  @IsInt({ message: MINUTES })
  @Min(MIN_START_MINUTES, { message: MINUTES })
  @Max(MAX_START_MINUTES, { message: MINUTES })
  startMinutes!: number;

  @IsInt({ message: MINUTES })
  @Min(MIN_END_MINUTES, { message: MINUTES })
  @Max(MAX_END_MINUTES, { message: MINUTES })
  endMinutes!: number;

  @IsInt({ message: SLOT })
  @Min(MIN_SLOT_MINUTES, { message: SLOT })
  @Max(MAX_SLOT_MINUTES, { message: SLOT })
  slotMinutes!: number;
}

/**
 * A window the teacher is moving.
 *
 * `isActive` is deliberately absent: retirement is its own endpoint, so an edit that could clear
 * the flag would be a way to close a window while pretending to re-time it. A body that names no
 * field at all is a save that changed nothing, and the route answers it as one. The service
 * checks the four numbers together after filling in whatever this body left out.
 */
export class UpdateAvailabilityRuleDto {
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
  @Min(MIN_END_MINUTES, { message: MINUTES })
  @Max(MAX_END_MINUTES, { message: MINUTES })
  endMinutes?: number;

  @IsOptional()
  @IsInt({ message: SLOT })
  @Min(MIN_SLOT_MINUTES, { message: SLOT })
  @Max(MAX_SLOT_MINUTES, { message: SLOT })
  slotMinutes?: number;
}
