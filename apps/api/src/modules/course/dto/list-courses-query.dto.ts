import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The only filter a teacher's own list offers. `status` is a lookup code that the service
 * resolves — a code the catalogue does not have is a mistake worth reporting, not a
 * request that quietly answers with an empty list.
 */
export class ListCoursesQueryDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 32)
  status?: string;
}
