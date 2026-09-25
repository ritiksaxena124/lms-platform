import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC = 'lms:public-route';

/**
 * Marks an endpoint reachable without a session.
 *
 * The guard is global and the annotation is the exception, so a route that forgets it fails
 * as "401 on a page nobody can sign into" — noticed immediately in development — while the
 * opposite mistake, forgetting to *require* auth, ships silently.
 */
export function Public(): CustomDecorator<string> {
  return SetMetadata(IS_PUBLIC, true);
}
