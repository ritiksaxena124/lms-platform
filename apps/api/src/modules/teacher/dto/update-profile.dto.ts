import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { IsIanaTimeZone } from '../../../common/validation/iana-timezone.validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimmedItems = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

/**
 * An amount is only meaningful next to a currency, so the two are validated as one
 * decision: `@ValidateIf` runs both whenever either appears, which means a rate with no
 * currency is reported against `currency` and the missing half is named where the form
 * can highlight it. `@IsOptional` is deliberately *not* used here — it skips a property
 * when it is absent, and an absent currency is exactly the case that must fail.
 */
const moneyIsBeingSet = (dto: UpdateTeacherProfileDto): boolean =>
  dto.hourlyRateMinorUnits !== undefined || dto.currency !== undefined;

/**
 * The whole teacher profile document, sent by a form that shows what it loaded. `PUT`
 * replaces it, so a subject removed in the form arrives as a subject that is simply not
 * in the list rather than as a second instruction to delete it.
 */
export class UpdateTeacherProfileDto {
  @Transform(trimmed)
  @IsString()
  @Length(3, 140)
  headline!: string;

  /** Absent is allowed; an empty string is what "I deleted my bio" looks like from a form. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 5000)
  bio?: string;

  @Transform(trimmedItems)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  subjects!: string[];

  @Transform(trimmed)
  @IsIanaTimeZone()
  timezone!: string;

  /** Minor units, because the client that typed "₹1,200" and the server that stores it
   * must never meet in a float. The ceiling is a mistake detector, not a policy. */
  @ValidateIf(moneyIsBeingSet)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  hourlyRateMinorUnits?: number;

  @ValidateIf(moneyIsBeingSet)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code like INR' })
  currency?: string;
}
