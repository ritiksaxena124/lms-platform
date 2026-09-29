import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import {
  ACTION_CODES,
  ACTION_SECTION_CODES,
  ACTION_TARGET_TABLE_CODES,
  type ActionCode,
  type ActionSectionCode,
  type ActionTargetTableCode,
} from '@lms/shared';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The question an operator asks the ledger.
 *
 * Every filter here rides an index `action_log` carries — the account, the target pair, the action
 * code, and the section, which is the one this read side had to add — so the five questions a log is
 * kept for are also the five that stay cheap as it grows. There is no full-text search and no
 * `q`, because a row's own words are codes and a uuid, and a screen that wants prose about them is
 * Phase 8's.
 *
 * The three code filters are checked against `@lms/shared`, not against the database: the lists are
 * closed on the code side (that was 7a's argument for keeping them out of `Lkp*`), so a value
 * outside one is a mistake rather than a value somebody has not added yet, and an empty page is the
 * wrong answer to a nonsense question.
 */
export class ListActionsQueryDto {
  @IsOptional()
  @Transform(trimmed)
  @IsIn(Object.values(ACTION_SECTION_CODES))
  section?: ActionSectionCode;

  /** Narrower than the section, and asked on its own sometimes: the same decision, wherever it was
   * taken. `section` and `action` together are allowed — the shapes agree by construction. */
  @IsOptional()
  @Transform(trimmed)
  @IsIn(Object.values(ACTION_CODES))
  action?: ActionCode;

  /** Whose record this is, as an id rather than an address: the log holds no address to search, and
   * an operator who means a person has already found them. */
  @IsOptional()
  @IsUUID()
  actor?: string;

  /** Required when its partner is there, and validated when either of them is. An id alone is not a
   * question this route can answer without reading the log whole — `target_table` is the other half
   * of the index prefix — so the pair is what is asked for, and half a pair is a mistake. `@IsOptional`
   * would skip the row entirely whenever the field is missing, which is how a lone `targetId` slips
   * through as an empty page instead of a refusal. */
  @ValidateIf(
    (query: ListActionsQueryDto) => query.targetId !== undefined || query.targetTable !== undefined,
  )
  @Transform(trimmed)
  @IsDefined({ message: 'targetTable must be given together with targetId.' })
  @IsIn(Object.values(ACTION_TARGET_TABLE_CODES))
  targetTable?: ActionTargetTableCode;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  /** Both ends inclusive, and compared against `created_at`, which is the instant the transaction
   * that wrote the row timed it. A day of UTC rather than a local date is what an operator types
   * here, and the portal that draws the answer is the place that decides the zone. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** A log read is a screen scrolling, and no screen wants a hundred rows at once. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
