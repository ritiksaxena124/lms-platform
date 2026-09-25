import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES } from '@lms/shared';

import {
  ApiError,
  apiJson,
  describeFailure,
  fieldErrors,
  onSessionLost,
  refreshSession,
  setAccessToken,
} from './api';

const BASE_URL = 'http://api.localtest.me:4000';

/** A stand-in for `Response`: jsdom has no fetch, and the client only reads these parts. */
function fakeResponse(status: number, body: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

function lastRequest(call: number): { url: string; init: RequestInit } {
  const call_ = fetchMock.mock.calls[call];
  if (!call_) throw new Error(`Only ${fetchMock.mock.calls.length} request(s) were made`);
  return { url: String(call_[0]), init: call_[1] as RequestInit };
}

function authHeaderOf(call: number): string | null {
  const headers = lastRequest(call).init.headers as Record<string, string> | undefined;
  const key = Object.keys(headers ?? {}).find((name) => name.toLowerCase() === 'authorization');
  return (key && headers?.[key]) || null;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('apiJson', () => {
  it('refuses to guess a base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');

    await expect(apiJson<{ user: unknown }>('/auth/me')).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bearer token next to the cookies', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValue(fakeResponse(200, { user: { id: 'u1' } }));

    await expect(apiJson<{ user: { id: string } }>('/auth/me')).resolves.toEqual({
      user: { id: 'u1' },
    });

    const { url, init } = lastRequest(0);
    expect(url).toBe(`${BASE_URL}/api/v1/auth/me`);
    expect(init.credentials).toBe('include');
    expect(authHeaderOf(0)).toBe('Bearer token-abc');
  });

  it('omits the header rather than sending "Bearer null"', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { user: { id: 'u1' } }));

    await apiJson('/auth/me');

    expect(authHeaderOf(0)).toBeNull();
  });

  it('carries the error envelope across unchanged', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(403, {
        statusCode: 403,
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'This account is not allowed to do that.',
        requestId: 'req-9',
      }),
    );

    const error = await apiJson('/teacher/profile').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe(API_ERROR_CODES.FORBIDDEN);
    expect(apiError.message).toBe('This account is not allowed to do that.');
    expect(apiError.statusCode).toBe(403);
    expect(apiError.requestId).toBe('req-9');
  });

  it('turns a body that is not the envelope into a readable failure', async () => {
    fetchMock.mockResolvedValue({
      status: 502,
      ok: false,
      text: async () => '<html>Bad Gateway</html>',
    });

    const error = (await apiJson('/auth/me').catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(502);
    expect(error.message).not.toContain('<html>');
  });

  it('reports an unreachable API without a stack from the transport', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = (await apiJson('/auth/me').catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.statusCode).toBe(0);
  });

  it('returns undefined for a 204 instead of parsing nothing', async () => {
    fetchMock.mockResolvedValue(fakeResponse(204, undefined));

    await expect(apiJson<void>('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('token refresh', () => {
  const sessionBody = (accessToken: string) => ({
    user: { id: 'u1', email: 'teacher@example.test', fullName: 'Aditi Sharma', role: 'teacher' },
    accessToken,
    tokenType: 'Bearer' as const,
    expiresIn: 900,
  });

  it('replays a rejected call once with the fresh token', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.TOKEN_EXPIRED, message: 'x' }),
      )
      .mockResolvedValueOnce(fakeResponse(200, sessionBody('fresh')))
      .mockResolvedValueOnce(fakeResponse(200, { profile: null }));

    await expect(apiJson('/teacher/profile')).resolves.toEqual({ profile: null });

    expect(lastRequest(1).url).toBe(`${BASE_URL}/api/v1/auth/refresh`);
    expect(lastRequest(1).init.method).toBe('POST');
    expect(authHeaderOf(1)).toBeNull();
    expect(authHeaderOf(2)).toBe('Bearer fresh');
  });

  it('gives up after one replay instead of looping', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.TOKEN_EXPIRED, message: 'x' }),
      )
      .mockResolvedValueOnce(fakeResponse(200, sessionBody('fresh')))
      .mockResolvedValueOnce(
        fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.TOKEN_INVALID, message: 'x' }),
      );

    await expect(apiJson('/teacher/profile')).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not refresh for an error the cookie cannot fix', async () => {
    setAccessToken('stale');
    fetchMock.mockResolvedValue(
      fakeResponse(403, { statusCode: 403, code: API_ERROR_CODES.FORBIDDEN, message: 'x' }),
    );

    await expect(apiJson('/teacher/profile')).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not revive a session for the call that ends it', async () => {
    setAccessToken('stale');
    fetchMock.mockResolvedValue(
      fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.UNAUTHORIZED, message: 'x' }),
    );

    await expect(apiJson('/auth/logout', { method: 'POST', reviveSession: false })).rejects.toThrow(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between requests that expire together', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.TOKEN_EXPIRED, message: 'x' }),
      )
      .mockResolvedValueOnce(
        fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.TOKEN_EXPIRED, message: 'x' }),
      )
      .mockResolvedValueOnce(fakeResponse(200, sessionBody('fresh')))
      .mockResolvedValueOnce(fakeResponse(200, { profile: 'a' }))
      .mockResolvedValueOnce(fakeResponse(200, { courses: 'b' }));

    const [first, second] = await Promise.all([apiJson('/teacher/profile'), apiJson('/courses')]);

    expect(first).toEqual({ profile: 'a' });
    expect(second).toEqual({ courses: 'b' });
    const refreshCalls = Array.from({ length: fetchMock.mock.calls.length }, (_, i) => i).filter(
      (i) => lastRequest(i).url.endsWith('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('clears the dead token and says so when the cookie is rejected', async () => {
    const lost = vi.fn();
    const unsubscribe = onSessionLost(lost);
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.TOKEN_EXPIRED, message: 'x' }),
      )
      .mockResolvedValueOnce(
        fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.UNAUTHORIZED, message: 'x' }),
      );

    await expect(apiJson('/teacher/profile')).rejects.toThrow(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledTimes(1);
    unsubscribe();

    fetchMock.mockResolvedValueOnce(fakeResponse(200, { user: { id: 'u1' } }));
    await apiJson('/auth/me');
    expect(authHeaderOf(2)).toBeNull();
  });

  it('refreshSession resolves to nothing when there is no session to revive', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(401, { statusCode: 401, code: API_ERROR_CODES.UNAUTHORIZED, message: 'x' }),
    );

    await expect(refreshSession()).resolves.toBeNull();
  });

  it('refreshSession keeps the new token for the request after it', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, sessionBody('bootstrapped')))
      .mockResolvedValueOnce(fakeResponse(200, { user: { id: 'u1' } }));

    await expect(refreshSession()).resolves.toMatchObject({ accessToken: 'bootstrapped' });
    await apiJson('/auth/me');

    expect(authHeaderOf(0)).toBeNull(); // bootstrapping authenticates with the cookie alone
    expect(authHeaderOf(1)).toBe('Bearer bootstrapped');
  });
});

describe('fieldErrors', () => {
  it('normalises single messages into lists the form can render', () => {
    const error = new ApiError({
      statusCode: 400,
      code: API_ERROR_CODES.VALIDATION_FAILED,
      message: 'Check the highlighted fields.',
      details: {
        validation: {
          email: ['An account with that address already exists'],
          password: ['Use at least 12 characters', 'Add a number or symbol'],
        },
      },
    });

    expect(fieldErrors(error)).toEqual({
      email: ['An account with that address already exists'],
      password: ['Use at least 12 characters', 'Add a number or symbol'],
    });
  });

  it('is empty for anything that is not a validation failure', () => {
    expect(fieldErrors(new Error('boom'))).toEqual({});
    expect(fieldErrors(undefined)).toEqual({});
  });
});

describe('describeFailure', () => {
  it('repeats what the API said', () => {
    const error = new ApiError({
      statusCode: 401,
      code: API_ERROR_CODES.INVALID_CREDENTIALS,
      message: 'Email or password is not correct.',
    });

    expect(describeFailure(error)).toBe('Email or password is not correct.');
  });

  it('covers a failure with no message of its own', () => {
    expect(describeFailure(new Error(''))).not.toBe('');
    expect(describeFailure('a plain string')).toBe('a plain string');
    expect(describeFailure(undefined)).not.toBe('');
  });
});
