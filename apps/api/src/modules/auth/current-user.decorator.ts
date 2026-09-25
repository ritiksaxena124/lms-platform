import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { API_ERROR_CODES } from '@lms/shared';
import type { Request } from 'express';

import type { AuthenticatedUser } from './auth.guard';

/**
 * `@CurrentUser() user: AuthenticatedUser` in a handler.
 *
 * Throws rather than handing back `undefined` because the only way to reach that state is a
 * route that is public *and* written as if it were protected — which is a bug to hear about
 * at request time, not a 500 on `user.id`.
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
