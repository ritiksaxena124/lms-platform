import { Injectable, Inject } from '@nestjs/common';
import { sign, TokenExpiredError, verify } from 'jsonwebtoken';

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

/**
 * `expired` and `invalid` are different answers on purpose. A client that hears `expired`
 * posts to /auth/refresh and retries the request as if nothing happened; a client that
 * hears `invalid` has lost its session and goes back to the sign-in form. Collapsing them
 * means either retrying a forged token forever or logging people out over a clock skew.
 */
export type AccessTokenVerification =
  { valid: true; claims: AccessTokenClaims } | { valid: false; reason: 'expired' | 'invalid' };

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * The signing port. Every caller goes through `issue`/`check`, so moving to RS256 — or to
 * a key set, once a second service needs to verify tokens without the secret — is a change
 * to this file and nothing else.
 */
export const ACCESS_TOKENS = Symbol('ACCESS_TOKENS');

export interface AccessTokenPort {
  issue(claims: AccessTokenClaims): IssuedAccessToken;
  check(token: string): AccessTokenVerification;
}

/** Pinned so a token minted for this API is not valid for anything else holding it. */
const ISSUER = 'lms-api';
const AUDIENCE = 'lms-portals';

/**
 * HS256 bearer tokens: stateless, so the API answers a request without a session lookup,
 * and short-lived, which is what makes "stateless" safe here.
 *
 * They carry an id and a role and nothing else — a JWT is read by whoever holds it, so an
 * email or a name in the payload is a copy of personal data that outlives the login that
 * produced it. Signing out is a refresh-token event; the access token is simply too short
 * to be worth a revocation list, and `JwtAuthGuard` re-reads the account behind it anyway.
 */
@Injectable()
export class JwtAccessTokens implements AccessTokenPort {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  issue(claims: AccessTokenClaims): IssuedAccessToken {
    const token = sign({ ...claims, typ: 'access' }, this.secret(), {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return { token, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  }

  check(token: string): AccessTokenVerification {
    try {
      const payload = verify(token, this.secret(), {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      // A token for another purpose must not pass as a session, even correctly signed.
      if (typeof payload === 'string' || payload.typ !== 'access') {
        return { valid: false, reason: 'invalid' };
      }
      return { valid: true, claims: { sub: String(payload.sub), role: String(payload.role) } };
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof TokenExpiredError ? 'expired' : 'invalid',
      };
    }
  }

  private secret(): string {
    if (!this.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured; access tokens cannot be signed');
    }
    return this.env.JWT_SECRET;
  }
}
