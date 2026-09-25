import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A URL segment a person may end up reading aloud to a colleague. Lowercase letters,
 * digits and single hyphens: anything else is a segment that changes meaning once it is
 * percent-encoded in an address bar.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/;

const slugMessage = 'Use lowercase letters, numbers and hyphens, 3 to 80 characters';

/**
 * What the create form sends. `status` is deliberately not a field here: publishing is a
 * decision with a check attached to it, and a body that could write `status: 'published'`
 * would skip that check without anyone noticing.
 */
export class CreateCourseDto {
  @Transform(trimmed)
  @IsString()
  @Length(4, 120)
  title!: string;

  /** Absent means "derive it from the title", which is what a teacher expects when they
   * have not thought about the address yet. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(SLUG_PATTERN, { message: slugMessage })
  slug?: string;

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

  /** A `CourseLevel` lookup code, checked against the catalogue by the service. */
  @Transform(trimmed)
  @IsString()
  @Length(2, 64)
  level!: string;
}

/** Every field is optional; the ones that are absent are unchanged, not cleared. */
export class UpdateCourseDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(4, 120)
  title?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(SLUG_PATTERN, { message: slugMessage })
  slug?: string;

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

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 64)
  level?: string;
}
