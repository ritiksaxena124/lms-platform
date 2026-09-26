import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A URL segment a person may end up reading aloud to a colleague. Lowercase letters,
 * digits and single hyphens: anything else is a segment that changes meaning once it is
 * percent-encoded in an address bar.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/;

const slugMessage = 'Use lowercase letters, numbers and hyphens, 3 to 80 characters';

/** The column is an `Int`, so this is the largest figure it will hold — a ceiling set at
 * a tenth of that because a teacher who meant ₹4,999 and typed twelve digits has made a
 * mistake the platform should refuse rather than shelve. */
const MAX_PRICE_MINOR_UNITS = 200_000_000;

/**
 * The two halves of a price, which arrive together or not at all.
 *
 * The amount is in minor units because a body that sent `4999.99` would be carrying a float
 * across the network to land in an integer column, and `4999.005` is a figure no student
 * could be asked to pay. There is deliberately no `@Type(() => Number)` conversion: this is a
 * JSON body, a number arrives as a number, and a string that quietly became `0` would be a
 * course published as free.
 */
export class CoursePriceDto {
  @IsInt({ message: 'Give the amount in the smallest unit — paise, not rupees.' })
  @Min(0, { message: 'A price cannot be below zero.' })
  @Max(MAX_PRICE_MINOR_UNITS, { message: 'That is more than this platform can hold.' })
  minorUnits!: number;

  /** A `Currency` lookup code, resolved by the service the way a level is — so a code the
   * catalogue does not carry comes back as a field error rather than a database complaint. */
  @Transform(trimmed)
  @IsString({ message: 'Choose the currency this price is quoted in.' })
  @Length(2, 64)
  currency!: string;
}

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

  /** Optional in the plainest sense: a course nobody has priced is a course with nothing on
   * its shelf, not a course that costs zero. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CoursePriceDto)
  price?: CoursePriceDto | null;
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

  /** The one field here that a form sends on purpose when it is empty: `null` means "take the
   * price off", while leaving the key out means "say nothing about it". A patch that read the
   * two the same way would clear a quote every time a teacher edited a typo in the title. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CoursePriceDto)
  price?: CoursePriceDto | null;
}
