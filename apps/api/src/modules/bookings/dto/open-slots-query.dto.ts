import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Which course's calendar a student has opened.
 *
 * One parameter, and a required one: the grid is cut from a teacher's week, so there is no
 * sensible answer to "when is this teacher free" that does not start by naming the course — a
 * booking is always for a course, even a demo call, which is what the cap and the trial setting
 * are per-course about.
 *
 * The value is a course address, so it is read as text and decided by the service: an id is a
 * uuid and anything else is a slug, which is the rule the catalog already applies to links.
 */
export class OpenSlotsQueryDto {
  @Type(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  course!: string;
}
