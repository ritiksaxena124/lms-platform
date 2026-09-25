import type { Response } from 'express';

import { API_PREFIX } from '../../common/http/api-prefix';
import type { AppEnv } from '../../config/env';

/** The name is exported because the portals have to agree on it; the value is not. */
export const REFRESH_COOKIE = 'lms_refresh';

/** Only the auth endpoints read it, so only they should carry it on every request. */
const PATH = `${API_PREFIX}/auth`;

export function setRefreshCookie(res: Response, token: string, env: AppEnv): void {
  res.cookie(REFRESH_COOKIE, token, cookieOptions(env, refreshTokenMaxAge(env)));
}

/**
 * Expiry 0 rather than a past date: some browsers honour `Expires` inconsistently, and
 * every one of them drops a `Max-Age=0` cookie immediately.
 */
export function clearRefreshCookie(res: Response, env: AppEnv): void {
  res.cookie(REFRESH_COOKIE, '', cookieOptions(env, 0));
}

/**
 * Reads the cookie without a parser middleware. One name, one place — `cookie-parser`
 * would only exist to decode this single value.
 */
export function readRefreshCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join('=')) || undefined;
  }
  return undefined;
}

function cookieOptions(env: AppEnv, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure(env),
    path: PATH,
    maxAge,
    // Unset keeps the cookie to this host. Portals on *.localtest.me set it so one login
    // covers every portal; a host-only cookie would be invisible to the others.
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

function refreshTokenMaxAge(env: AppEnv): number {
  return env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
}

/** Local dev runs over plain http; anything that could face traffic must not. */
function cookieSecure(env: AppEnv): boolean {
  return env.cookieSecure;
}
