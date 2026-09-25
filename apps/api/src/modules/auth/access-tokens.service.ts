import { Injectable, Inject } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';

import { ENV } from '../../config/env.module';
import type { AppEnv } from '../../config/env';

/** Who the access token says the bearer is. Deliberately small — see `issue`. */
export interface AccessTokenClaims {
  sub: string;
  role: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresInSeconds: number;
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * The signing port. Every caller goes through `issue`/`claimsFor`, so moving to RS256 or a
 * key set when a second service needs to verify tokens is a change to this file.
 */
export const ACCESS_TOKENS = Symbol('ACCESS_TOKENS');

export interface AccessTokenPort {
  issue(claims: AccessTokenClaims): IssuedAccessToken;
  /** Throws on a bad signature or an expired token. */
  claimsFor(token: string): AccessTokenClaims;
}

/**
 * HS256 bearer tokens: stateless, so the API answers a request without a session lookup,
 * and short-lived, which is what makes "stateless" safe here.
 *
 * They carry an id and a role and nothing else — a JWT is read by whoever holds it, so an
 * email or a name in the payload is a copy of personal data that outlives the login that
 * produced it. Revocation lives on the refresh token instead: fifteen minutes is the price
 * of carrying no session store.
 */
@Injectable()
export class JwtAccessTokens implements AccessTokenPort {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  issue(claims: AccessTokenClaims): IssuedAccessToken {
    const token = sign({ ...claims, typ: 'access' }, this.requiredSecret(), {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'lms-api',
      audience: 'lms-portals',
    });
    return { token, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  }

  claimsFor(token: string): AccessTokenClaims {
    const payload = verify(token, this.requiredSecret(), {
      algorithms: ['HS256'],
      issuer: 'lms-api',
      audience: 'lms-portals',
    });
    if (typeof payload === 'string' || payload.typ !== 'access') {
      throw new Error('Not an access token');
    }
    return { sub: String(payload.sub), role: String(payload.role) };
  }

  private requiredSecret(): string {
    // parseEnv only enforces this in production, where a random per-process fallback would
    // log every user out on restart; failing here keeps the mistake loud either way.
    if (!this.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured; access tokens cannot be signed');
    }
    return this.env.JWT_SECRET;
  }
}
