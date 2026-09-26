import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { API_ERROR_CODES } from '@lms/shared';
import type { Request } from 'express';

import type { AuthenticatedUser } from './auth.guard';

/**
 * `@CurrentUser() user: AuthenticatedUser` in a handler.
 *
 * Throws rather than handing back `undefined` because the only way to reach that state is a
 * route that is public *and* written as if it were protected — which is a bug to hear about
 * at request time, not a 500 on `user.id`. A route that genuinely means to answer for a
 * stranger is `@OptionalSession()`, and asks with `OptionalCurrentUser` below.
 */
export const CurrentUser = createParamDecorator((_unknown: never, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<Request>().user;
  if (!user) {
    throw new UnauthorizedException({
      code: API_ERROR_CODES.UNAUTHORIZED,
      message: 'Sign in to continue.',
    });
  }
  return user as AuthenticatedUser;
});

/**
 * `@OptionalCurrentUser() user: AuthenticatedUser | undefined`, paired with `@OptionalSession()`.
 *
 * The `undefined` is a caller who brought nothing, not a hole to fall through: the guard has
 * already refused any token that was present and broken. `CurrentUser` would throw here, which
 * is the right default everywhere else and the wrong one on a route built for both audiences.
 */
export const OptionalCurrentUser = createParamDecorator(
  (_unknown: never, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<Request>().user,
);
