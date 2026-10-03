import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCOUNT_STATUS_CODES, API_ERROR_CODES, permissionsForRole } from '@lms/shared';
import type { PermissionCode, RoleCode } from '@lms/shared';
import type { Request } from 'express';

import { identifyInLogContext } from '../../common/logging/log-context';
import { ACCESS_TOKENS, type AccessTokenPort } from './access-tokens.service';
import { REQUIRED_PERMISSIONS } from './permissions.decorator';
import { IS_PUBLIC } from './public.decorator';
import { OPTIONAL_SESSION } from './optional-session.decorator';
import { UsersRepository } from './users.repository';

/** What a handler may assume about whoever called it. Set by `JwtAuthGuard` or never. */
export interface AuthenticatedUser {
  id: string;
  /** Read from the account, not from the token — see `PermissionsGuard`. */
  role: RoleCode;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokenPort,
    private readonly users: UsersRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scopes = [context.getHandler(), context.getClass()];

    // Checked before the public flag on purpose: a route that wants to know who is asking
    // even though it will answer one anyway is the case `@Public()` would otherwise swallow.
    // With no header this is exactly the public path — an absent caller is a stranger, not a
    // refusal — and with one the token is resolved below, so `OptionalCurrentUser` can be
    // `undefined` here and can never be a forged identity.
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_SESSION, scopes);

    // The public flag is only ever a statement about this route. Turning it off for
    // everything is a code change, not a header an attacker can send.
    if (!optional && this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, scopes)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      // A route that asked for the caller's identity without demanding it: nobody offered
      // one, so the handler runs as a stranger.
      if (optional) return true;

      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Sign in to continue.',
      });
    }

    const verified = this.tokens.check(token);
    if (!verified.valid) {
      throw new UnauthorizedException({
        code:
          verified.reason === 'expired'
            ? API_ERROR_CODES.TOKEN_EXPIRED
            : API_ERROR_CODES.TOKEN_INVALID,
        message:
          verified.reason === 'expired'
            ? 'Session has expired. Please sign in again.'
            : 'Session is not recognised.',
      });
    }

    // The token is only an assertion that somebody signed in. Whether that person still
    // *is* allowed in — and as which role — is a question about the row, asked now.
    const user = await this.users.findById(verified.claims.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.TOKEN_INVALID,
        message: 'Session is not recognised.',
      });
    }
    if (user.status.code !== ACCOUNT_STATUS_CODES.ACTIVE) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.ACCOUNT_DISABLED,
        message: 'This account is disabled. Contact support.',
      });
    }

    request.user = { id: user.id, role: user.role.code as RoleCode };
    // The same answer, bound for everything the request goes on to do. `@CurrentUser` is how a
    // handler learns who is asking; this is how a write several calls downstream can record it
    // without every signature in the path being widened to carry it. Phase 7's recorder reads it,
    // and the role it stores is this one — from the row, now — rather than the token's claim.
    identifyInLogContext({ userId: user.id, userRole: user.role.code as RoleCode });
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Sign in to continue.',
      });
    }

    // The matrix, read fresh: no capability is stored on the account, so what a role can do is a
    // fact about the code rather than about a row somebody could edit into a wider door.
    const held = permissionsForRole(user.role);
    if (!required.every((code) => held.includes(code))) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'This account is not allowed to do that.',
      });
    }
    return true;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  const [scheme, value, extra] = header?.split(' ') ?? [];
  if (extra || scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value;
}
