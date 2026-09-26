import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const OPTIONAL_SESSION = 'lms:optional-session';

/**
 * Reads a session if the caller brought one, and asks for nothing if they did not.
 *
 * This is not a relaxed `@Public()`. A public route ignores the header entirely; this one
 * resolves it, which is the only way a single endpoint can answer two different audiences —
 * a stranger reading the page a teacher left open, and a student reading the pages their own
 * enrollment opens. The alternative is two routes with two copies of the same gates, and the
 * copy that forgets a gate is the bug that ships.
 *
 * A token that is present and broken is refused exactly as it would be on a protected route.
 * Falling back to "treat them as a stranger" would let an expired session quietly read a
 * locked page's outline forever, with the refresh path never running.
 */
export function OptionalSession(): CustomDecorator<string> {
  return SetMetadata(OPTIONAL_SESSION, true);
}
