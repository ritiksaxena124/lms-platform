import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What a browsing student may narrow the catalog by.
 *
 * There is no `status` here, because there is no second status to ask for: everything this
 * route can reach is published, and the teacher's own list — which can show drafts — is a
 * different route on purpose.
 *
 * `page` and `pageSize` are numbers by the time the service sees them. A query string is
 * text, so the coercion happens where the rest of the request's shape is checked rather than
 * in a service comparing `'2'` with `2`.
 */
export class ListCatalogQueryDto {
  /** A `CourseLevel` lookup code, resolved by the service. A code the catalogue does not
   * carry is reported, not answered with an empty page. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 64)
  level?: string;

  /** Matched against a title and a one-line summary — the two fields a card shows, so a
   * search never promises a hit the list cannot explain. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  pageSize?: number;
}
