import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MAIL_OUTBOX_STATUS_CODES, type MailOutboxStatusCode } from '@lms/shared';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The question an operator asks the queue, which is two questions.
 *
 * "What is still waiting" is the status filter, and it is the reason the row's state is a column the
 * sweep moves rather than something derived from timestamps. "What has this person's news done" is
 * the recipient filter, and it arrives as an id rather than an address for the reason the ledger's
 * `actor` filter does: the queue holds no address to search, and an operator who means a person has
 * already found them through `/users`.
 *
 * There is no `q` and no event filter. The first would have to search `payload`, which this route
 * deliberately does not read; the second rides no index, and seven events are few enough to pick out
 * of a page of twenty-five by eye.
 *
 * The status is checked against `@lms/shared` rather than the database, the way the ledger's codes
 * are: the list is closed on the code side, so a value outside it is a mistake rather than a state
 * somebody has not added yet, and an empty page is the wrong answer to a nonsense question.
 */
export class ListOutboxQueryDto {
  @IsOptional()
  @Transform(trimmed)
  @IsIn(Object.values(MAIL_OUTBOX_STATUS_CODES))
  status?: MailOutboxStatusCode;

  @IsOptional()
  @IsUUID()
  recipient?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** A queue read is a screen scrolling, and no screen wants a hundred rows at once. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
