import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What "add a lesson" accepts.
 *
 * `position` is absent for the reason it is absent on a module, and `status` is absent for a
 * different one: publishing a page is a promise to a student, so it goes through the
 * transition that can check it rather than through a field a form could set while the body
 * was still empty.
 */
export class CreateLessonDto {
  @Transform(trimmed)
  @IsString()
  @Length(3, 120)
  title!: string;

  /** The page itself. Optional here because naming a lesson is a planning act — a title on
   * its own is a row worth keeping — and an empty one simply cannot be published. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 20_000)
  body?: string;

  /** An estimate a student reads, never a duration the platform enforces. Ten hours is the
   * ceiling because anything above it is a term rather than a page. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  estimatedMinutes?: number | null;
}

/**
 * Every field is optional; the ones that are absent are unchanged, not cleared.
 *
 * `moduleId` is the exception with a consequence: setting it moves the lesson, and a lesson
 * that arrives in a block takes the end of that block's order rather than the slot it held in
 * the one it left.
 */
export class UpdateLessonDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(3, 120)
  title?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 20_000)
  body?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  estimatedMinutes?: number | null;

  /** Deliberately absent from `CreateLessonDto`: a page opens to strangers by decision, and
   * a form that never showed the box should not be able to leave one unlocked. */
  @IsOptional()
  @IsBoolean()
  isFreePreview?: boolean;

  @IsOptional()
  @IsUUID('4')
  moduleId?: string;
}

/**
 * The whole of one module's order, in the new sequence. A partial list is rejected rather
 * than silently renumbering the lessons it did not mention — and a lesson of a different
 * module is not one of this module's slots, so it cannot be named here at all.
 */
export class ReorderLessonsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  lessonIds!: string[];
}
