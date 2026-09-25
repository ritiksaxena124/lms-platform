import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What "add a module" accepts. `position` is not a field: a body that could name its own
 * slot could name one another module already holds, and the unique index would answer with
 * a 500 about someone's drag-and-drop.
 */
export class CreateCourseModuleDto {
  /** Three characters, not a course's four: a module heading is a label over a group of
   * lessons, and `101` and `Ratios` are both worth having. */
  @Transform(trimmed)
  @IsString()
  @Length(3, 120)
  title!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 180)
  summary?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 5000)
  description?: string;
}

/** Every field is optional; the ones that are absent are unchanged, not cleared. */
export class UpdateCourseModuleDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(3, 120)
  title?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 180)
  summary?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 5000)
  description?: string;
}

/**
 * The whole syllabus, in the new order. A partial list is rejected here rather than
 * silently renumbering the modules it did not mention: an endpoint that moves what it was
 * shown would leave the rest in an order nobody asked for.
 */
export class ReorderCourseModulesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  moduleIds!: string[];
}
