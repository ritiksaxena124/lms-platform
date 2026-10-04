import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ATTENDANCE_STATUS_CODES } from '@lms/shared';

/**
 * One name and what the teacher says about them.
 *
 * The person is named by their user id rather than by the register line's id, because the teacher
 * looked at a *name* when they answered: the line is found from the pair (this class, this person),
 * which is the key the table already guards. Sending the line id back would let a stale screen
 * write on a class it was never read from.
 */
export class RollLineDto {
  @IsString()
  @IsNotEmpty()
  studentId!: string;

  /**
   * Present, absent, or nothing at all — and the nothing is a real answer rather than a missing
   * field, because taking a mark back is how a teacher corrects a line they put wrong. Omitting the
   * key and sending it as `null` mean the same thing here, so both clear the line.
   */
  @IsOptional()
  @IsIn([ATTENDANCE_STATUS_CODES.PRESENT, ATTENDANCE_STATUS_CODES.ABSENT])
  status?: string | null;
}

/**
 * The marks a teacher is making on one class.
 *
 * A list of answers, not a replacement of the sheet: a name the body does not mention keeps
 * whatever mark it had, so a screen that saves the three lines it touched cannot quietly un-answer
 * the twelve it did not.
 */
export class SaveRollDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Say something about at least one name.' })
  @ValidateNested({ each: true })
  @Type(() => RollLineDto)
  lines!: RollLineDto[];
}
