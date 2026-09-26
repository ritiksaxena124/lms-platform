import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Which page of a roster the teacher asked for.
 *
 * There is no filter here — not a name, not a date, not "who left". A roster is a class list a
 * teacher reads top to bottom, and the first version of it does not need a search box to be
 * honest; a query parameter added now would be one more surface whose meaning has to be kept in
 * step with the page beneath it.
 *
 * `page` and `pageSize` are numbers by the time the service sees them, for the reason the
 * catalog gives: a query string is text, and the coercion belongs where the rest of the
 * request's shape is checked.
 */
export class ListRosterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** One hundred rows is a page nobody reads and a database still has to sort. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
