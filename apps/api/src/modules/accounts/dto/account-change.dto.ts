import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

import {
  ACCOUNT_STATUS_CODES,
  type AccountStatusCode,
  ROLE_CODES,
  type RoleCode,
} from '@lms/shared';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The two bodies the accounts screen sends, and the reason neither carries anything else.
 *
 * Both are one word. An operator is not editing a person's name, address or timezone here — those
 * belong to the account holder, and a route that could rewrite them from the inside would be a
 * support desk with no record of whose name an account now answers to. What is left is the two
 * things an account cannot decide for itself: whether it may sign in, and which portal it opens.
 *
 * There is no free-text `reason` field, and that is a decision about the ledger rather than about
 * this form. A record is allowed one kind of prose — the flat, decided facts of `detail` — and a
 * box an operator types into is where an address, a ticket number from another system, or a note
 * about a person would land in a table that is kept forever and read by whoever holds the ops role.
 */
export class ChangeAccountStatusDto {
  @Transform(trimmed)
  @IsIn(Object.values(ACCOUNT_STATUS_CODES))
  status!: AccountStatusCode;
}

export class ChangeAccountRoleDto {
  @Transform(trimmed)
  @IsIn(Object.values(ROLE_CODES))
  role!: RoleCode;
}
