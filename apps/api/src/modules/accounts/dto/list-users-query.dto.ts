import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import {
  ACCOUNT_STATUS_CODES,
  type AccountStatusCode,
  ROLE_CODES,
  type RoleCode,
} from '@lms/shared';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The question an operator asks the account table.
 *
 * `q` searches the two things a person arrives at an accounts screen with: the name on the account
 * and the address they gave. It is a substring, not a prefix, so an operator pasting a forwarded
 * email with the display name glued in front of it still finds the row — and it is two characters
 * minimum, because one letter against a table of accounts is a page of noise that reads as a result.
 *
 * `role` and `status` are checked against `@lms/shared` rather than against the lookup rows: both are
 * closed lists on the code side, so a value outside one is a mistake to report rather than a category
 * somebody has not added yet, and an empty page is the wrong answer to a nonsense question.
 */
export class ListUsersQueryDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 120)
  q?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsIn(Object.values(ROLE_CODES))
  role?: RoleCode;

  @IsOptional()
  @Transform(trimmed)
  @IsIn(Object.values(ACCOUNT_STATUS_CODES))
  status?: AccountStatusCode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
