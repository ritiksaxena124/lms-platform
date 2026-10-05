import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../../config/env';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './session-cookie';

/**
 * A cookie is keyed by name *and* Domain *and* Path, and a browser will send two `lms_refresh`
 * entries happily side by side when one was written before `COOKIE_DOMAIN` existed. Whichever
 * arrives first is the one the API reads, so a login can be shadowed by an account nobody signed
 * in to, and a logout can leave the other half signed in. These tests watch every `res.cookie`
 * write, because the attributes are the whole story.
 */
function fakeResponse() {
  const written: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const res = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      written.push({ name, value, options });
      return res;
    },
  };

  return {
    res: res as unknown as Parameters<typeof setRefreshCookie>[0],
    /** Every attribute is present and unset ones are absent, the way a browser sees them. */
    writes: written,
  };
}

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    cookieSecure: false,
    COOKIE_DOMAIN: 'localtest.me',
    REFRESH_TOKEN_TTL_DAYS: 7,
    ...overrides,
  } as AppEnv;
}

const PATH = '/api/v1/auth';

describe('setRefreshCookie', () => {
  it('writes the session under the shared domain, so one login covers every portal', () => {
    const { res, writes } = fakeResponse();

    setRefreshCookie(res, 'rt-1', env());

    const kept = writes.find((entry) => entry.value === 'rt-1');
    expect(kept).toBeDefined();
    expect(kept?.name).toBe(REFRESH_COOKIE);
    expect(kept?.options).toMatchObject({ path: PATH, domain: 'localtest.me', httpOnly: true });
  });

  it('expires the host-only twin beside it, because a stale half shadows a live session', () => {
    const { res, writes } = fakeResponse();

    setRefreshCookie(res, 'rt-1', env());

    // The twin is the same name on the same path with no Domain attribute, dead on arrival.
    const twin = writes.find((entry) => entry.value !== 'rt-1');
    expect(twin).toBeDefined();
    expect(twin?.name).toBe(REFRESH_COOKIE);
    expect(twin?.options.path).toBe(PATH);
    expect(twin?.options.domain).toBeUndefined();
    expect(twin?.options.maxAge).toBe(0);
  });

  it('writes a single host-only cookie where no domain is configured', () => {
    const { res, writes } = fakeResponse();

    setRefreshCookie(res, 'rt-1', env({ COOKIE_DOMAIN: undefined }));

    expect(writes).toHaveLength(1);
    expect(writes[0]?.options.domain).toBeUndefined();
  });
});

describe('clearRefreshCookie', () => {
  it('expires both halves, because signing out of one twin is still signed in', () => {
    const { res, writes } = fakeResponse();

    clearRefreshCookie(res, env());

    expect(writes).toHaveLength(2);
    expect(writes.every((entry) => entry.name === REFRESH_COOKIE)).toBe(true);
    expect(writes.every((entry) => entry.value === '')).toBe(true);
    expect(writes.every((entry) => entry.options.maxAge === 0)).toBe(true);
    expect(writes.some((entry) => entry.options.domain === 'localtest.me')).toBe(true);
    expect(writes.some((entry) => entry.options.domain === undefined)).toBe(true);
  });

  it('keeps the attributes that decide whether a browser accepts the expiry', () => {
    const { res, writes } = fakeResponse();

    clearRefreshCookie(res, env());

    // Same name, same path, same Domain attribute is the only way to expire a cookie. A clear
    // that drops `path` would expire `/` and leave `/api/v1/auth` standing.
    expect(writes.every((entry) => entry.options.path === PATH)).toBe(true);
    expect(writes.every((entry) => entry.options.httpOnly === true)).toBe(true);
  });
});
