import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Which stretch of the calendar the caller asked to see.
 *
 * Both bounds are instants rather than dates because a class is an instant: a portal that sends
 * `2026-03-01` would be asking about a day whose length depends on whose clock is reading it, and
 * the answer here is a list of rows keyed by UTC moments. An ISO instant with a zone suffix is what
 * the portals already hold from the previous response, so a screen can page forward by asking for
 * the next window without converting anything.
 *
 * Neither is required, and the default is not a guess the caller has to remember: leaving both out
 * asks for the horizon the generation sweep keeps filled, which is the only stretch where an empty
 * Tuesday means nobody teaches rather than meaning the platform stopped writing rows a month ago.
 * A screen that wants a specific week says so, and gets exactly that week.
 */
export class ListClassesQueryDto {
  @IsOptional()
  @IsISO8601({}, { message: 'Give the start of the window as an instant.' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'Give the end of the window as an instant.' })
  to?: string;
}
