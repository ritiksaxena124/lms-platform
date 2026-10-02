import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES } from '@lms/shared';

import {
  ApiError,
  apiBytes,
  apiGet,
  apiJson,
  describeFailure,
  fieldErrors,
  isForbidden,
  isUnreachable,
  NOT_A_LEARNER_MESSAGE,
  NETWORK_ERROR_CODE,
  onSessionLost,
  refreshSession,
  setAccessToken,
} from './api';

const BASE_URL = 'http://api.localtest.me:4000';

function jsonResponse(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

/** A recording, answered as bytes. The same route answers a refusal with a JSON envelope, so
 * this mock carries both halves — which is exactly the thing a caller has to tell apart.
 * `size` is what the tests read back: this environment's Blob cannot hand out its buffer. */
function bytesResponse(body: Uint8Array<ArrayBuffer>, status = 200) {
  const blob = new Blob([body], { type: 'video/mp4' });
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => '',
    blob: async () => blob,
  };
}

function requestAt(index: number): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function headerNames(index: number): Record<string, string> {
  return (requestAt(index).init.headers ?? {}) as Record<string, string>;
}

function authHeaderOf(index: number): string | null {
  const headers = headerNames(index);
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'authorization');
  return (key && headers[key]) || null;
}

/** The body a successful `/auth/refresh` answers with. */
const sessionBody = (accessToken: string) => ({
  user: { id: 'u1', email: 'student@example.test', fullName: 'Sam Iyer', role: 'student' },
  accessToken,
  tokenType: 'Bearer' as const,
  expiresIn: 900,
});

const unauthorized = () =>
  jsonResponse(
    { statusCode: 401, code: API_ERROR_CODES.UNAUTHORIZED, message: 'Sign in again.' },
    401,
  );
const expired = () =>
  jsonResponse({ statusCode: 401, code: API_ERROR_CODES.TOKEN_EXPIRED, message: 'Expired.' }, 401);

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

describe('apiGet', () => {
  it('refuses to guess a base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');

    await expect(apiGet<{ items: unknown[] }>('/catalog/courses')).rejects.toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the API under its prefix and hands back the body as it arrived', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ id: 'c1' }], page: 1 }));

    await expect(apiGet<{ items: { id: string }[] }>('/catalog/courses')).resolves.toEqual({
      items: [{ id: 'c1' }],
      page: 1,
    });
    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/catalog/courses`);
  });

  it('sends the query the caller built, untouched', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await apiGet('/catalog/courses', '?level=beginner&q=algebra&page=2');

    expect(requestAt(0).url).toBe(
      `${BASE_URL}/api/v1/catalog/courses?level=beginner&q=algebra&page=2`,
    );
  });

  it('carries nothing that identifies the visitor by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await apiGet('/catalog/courses');

    const { init } = requestAt(0);
    expect(authHeaderOf(0)).toBeNull();
    // A catalog read is answered by the row's own status, so a cookie would only be a way
    // for a cached page to leak one stranger's session to the next.
    expect(init.credentials).toBeUndefined();
  });

  it('leaves a failure as the server described it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 404,
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'We cannot find that course.',
          requestId: 'req-7',
        },
        404,
      ),
    );

    const error = await apiGet('/catalog/courses/nope').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOT_FOUND,
      message: 'We cannot find that course.',
      requestId: 'req-7',
    });
  });

  it('does not turn a gateway page into a wall of text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('<html><body>502 Bad Gateway</body></html>', 502));

    const error = await apiGet('/catalog/courses').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('The request did not succeed (502).');
  });

  it('says a refused connection is a connection problem', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await apiGet('/catalog/courses').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK_ERROR');
    expect(describeFailure(error)).toMatch(/unreachable/i);
  });
});

describe('a call that asks who is asking', () => {
  it('sends the token it holds, next to the cookies', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse({ course: { id: 'c1' } }));

    await apiGet('/catalog/courses/c1', '', { withSession: true });

    const { init } = requestAt(0);
    expect(init.credentials).toBe('include');
    expect(authHeaderOf(0)).toBe('Bearer token-abc');
  });

  it('still sends the cookies with no token, because the cookie is what decides', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ course: { id: 'c1' } }));

    await apiGet('/catalog/courses/c1', '', { withSession: true });

    // A reload onto a deep link leaves the access token nowhere and the cookie intact, so the
    // absence of a header is not evidence of an absent session.
    expect(authHeaderOf(0)).toBeNull();
    expect(requestAt(0).init.credentials).toBe('include');
  });

  it('leaves a shelf request a stranger’s request even when a token is held', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await apiGet('/catalog/courses', '?q=algebra');

    // The list is the same for everybody, so a session on it would only be a way for one
    // cached page to answer the next visitor as somebody else.
    expect(authHeaderOf(0)).toBeNull();
    expect(requestAt(0).init.credentials).toBeUndefined();
  });

  it('posts a place in a course with the session that entitles it', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrollment: { id: 'e1' } }));

    await apiJson('/enrollments', {
      method: 'POST',
      body: { courseId: 'c1' },
      withSession: true,
    });

    const { init } = requestAt(0);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ courseId: 'c1' }));
    expect(headerNames(0)['content-type']).toBe('application/json');
    expect(authHeaderOf(0)).toBe('Bearer token-abc');
  });

  it('does not revive a session for a request whose route has no caller', async () => {
    setAccessToken('stale');
    fetchMock.mockResolvedValueOnce(expired());

    // A stale token on a public read is nobody's business: the route answers the same for
    // anybody, and refreshing to find out would spend a rotation for nothing.
    await expect(apiGet('/catalog/courses')).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('apiBytes', () => {
  const FILE = new Uint8Array([1, 2, 3, 4, 5]);

  it('reads a recording as bytes, with the session that opens the door', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(bytesResponse(FILE));

    const blob = await apiBytes('/catalog/courses/c1/lessons/l1/video');

    expect(blob.size).toBe(FILE.length);
    expect(blob.type).toBe('video/mp4');
    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/catalog/courses/c1/lessons/l1/video`);
    // A recording is the part a student enrolled for, so the byte read is a sessioned call by
    // construction — there is no version of it that gets to look like a shelf request.
    expect(authHeaderOf(0)).toBe('Bearer token-abc');
    expect(requestAt(0).init.credentials).toBe('include');
    // Asking only for JSON would be asking a file route to refuse: the accept header is the
    // client saying what it can read, and a player can read anything the server sends.
    expect(headerNames(0)['accept']).toBe('*/*');
  });

  it('replays a byte read the stale token lost, once, with a fresh one', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(jsonResponse(sessionBody('fresh')))
      .mockResolvedValueOnce(bytesResponse(FILE));

    const blob = await apiBytes('/catalog/courses/c1/lessons/l1/video');

    expect(blob.size).toBe(FILE.length);
    expect(requestAt(1).url).toBe(`${BASE_URL}/api/v1/auth/refresh`);
    expect(authHeaderOf(2)).toBe('Bearer fresh');
  });

  it('hands back a refusal as the envelope the API wrote, not as an empty file', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 404,
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'We cannot find that recording.',
        },
        404,
      ),
    );

    const error = await apiBytes('/catalog/courses/c1/lessons/l1/video').catch(
      (thrown: unknown) => thrown,
    );

    // "No recording" and "not your page" both leave here, and a screen handed a Blob of zero
    // bytes could tell the student nothing about which happened.
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('We cannot find that recording.');
  });
});

describe('token refresh', () => {
  const read = () => ({ id: 'c1', title: 'Algebra slowly' });

  it('replays a rejected read once with the fresh token', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(jsonResponse(sessionBody('fresh')))
      .mockResolvedValueOnce(jsonResponse({ course: read() }));

    await expect(apiGet('/catalog/courses/c1', '', { withSession: true })).resolves.toEqual({
      course: read(),
    });

    expect(requestAt(1).url).toBe(`${BASE_URL}/api/v1/auth/refresh`);
    expect(requestAt(1).init.method).toBe('POST');
    expect(authHeaderOf(1)).toBeNull();
    expect(authHeaderOf(2)).toBe('Bearer fresh');
  });

  it('gives up after one replay instead of looping', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(jsonResponse(sessionBody('fresh')))
      .mockResolvedValueOnce(expired());

    await expect(apiGet('/catalog/courses/c1', '', { withSession: true })).rejects.toThrow(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not refresh for an error the cookie cannot fix', async () => {
    setAccessToken('stale');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 403, code: API_ERROR_CODES.FORBIDDEN, message: 'Not for this account.' },
        403,
      ),
    );

    await expect(
      apiJson('/enrollments', { method: 'POST', body: { courseId: 'c1' }, withSession: true }),
    ).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not revive a session for the call that starts or ends one', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized());

    // A wrong password is an answer, not a stale token, and a replayed logout would put a
    // session back after the person asked for it to end.
    await expect(
      apiJson('/auth/login', {
        method: 'POST',
        body: { email: 'a@b.test', password: 'x' },
        withSession: true,
        reviveSession: false,
      }),
    ).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between reads that expire together', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(jsonResponse(sessionBody('fresh')))
      .mockResolvedValueOnce(jsonResponse({ course: read() }))
      .mockResolvedValueOnce(jsonResponse({ lesson: { id: 'l1' } }));

    const withSession = { withSession: true } as const;
    const [outline, page] = await Promise.all([
      apiGet('/catalog/courses/c1', '', withSession),
      apiGet('/catalog/courses/c1/lessons/l1', '', withSession),
    ]);

    expect(outline).toEqual({ course: read() });
    expect(page).toEqual({ lesson: { id: 'l1' } });
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('clears the dead token and says so when the cookie is rejected', async () => {
    const lost = vi.fn();
    const unsubscribe = onSessionLost(lost);
    setAccessToken('stale');
    fetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(unauthorized());

    await expect(apiGet('/catalog/courses/c1', '', { withSession: true })).rejects.toThrow(
      ApiError,
    );

    expect(lost).toHaveBeenCalledTimes(1);
    unsubscribe();

    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    await apiGet('/catalog/courses/c1', '', { withSession: true });
    expect(authHeaderOf(2)).toBeNull();
  });

  it('refreshSession resolves to nothing when there is no session to revive', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized());

    await expect(refreshSession()).resolves.toBeNull();
  });

  it('refreshSession keeps the new token for the request after it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(sessionBody('bootstrapped')))
      .mockResolvedValueOnce(jsonResponse({ course: read() }));

    await expect(refreshSession()).resolves.toMatchObject({ accessToken: 'bootstrapped' });
    await apiGet('/catalog/courses/c1', '', { withSession: true });

    // Bootstrapping authenticates with the cookie alone; the read after it has a token.
    expect(authHeaderOf(0)).toBeNull();
    expect(authHeaderOf(1)).toBe('Bearer bootstrapped');
  });
});

describe('fieldErrors', () => {
  it('normalises single messages into lists the form can render', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 400,
          code: API_ERROR_CODES.VALIDATION_FAILED,
          message: 'Check the highlighted fields.',
          details: {
            validation: {
              email: 'An account with that address already exists',
              password: ['Use at least 12 characters', 'Add a number or symbol'],
            },
          },
        },
        400,
      ),
    );

    const error = await apiJson('/auth/register', {
      method: 'POST',
      body: {},
      reviveSession: false,
    }).catch((caught: unknown) => caught);

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
  it('has something to show for a failure with no message', () => {
    expect(describeFailure(new ApiError({ statusCode: 500, code: 'X', message: '   ' }))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('isForbidden', () => {
  it('names the refusal a role causes', () => {
    expect(
      isForbidden(
        new ApiError({
          statusCode: 403,
          code: API_ERROR_CODES.FORBIDDEN,
          message: 'This account is not allowed to do that.',
        }),
      ),
    ).toBe(true);
  });

  it('is not a stale session, a missing page, a dead connection or no failure at all', () => {
    // The three refusals a screen might otherwise lump in with this one each want their own
    // sentence: a refresh, a "not on the shelf", and a retry.
    expect(
      isForbidden(
        new ApiError({ statusCode: 401, code: API_ERROR_CODES.UNAUTHORIZED, message: 'no' }),
      ),
    ).toBe(false);
    expect(
      isForbidden(
        new ApiError({ statusCode: 404, code: API_ERROR_CODES.NOT_FOUND, message: 'no' }),
      ),
    ).toBe(false);
    expect(
      isForbidden(new ApiError({ statusCode: 0, code: NETWORK_ERROR_CODE, message: 'no' })),
    ).toBe(false);
    expect(isForbidden(undefined)).toBe(false);
    expect(isForbidden(new Error('boom'))).toBe(false);
  });

  it('says what to do about it, without quoting the API at the reader', () => {
    // The wire sentence ("This account is not allowed to do that.") is true but useless: it does
    // not say which account would work. Nothing here names a seeded address or a password.
    expect(NOT_A_LEARNER_MESSAGE).toMatch(/learner/i);
    expect(NOT_A_LEARNER_MESSAGE).toMatch(/sign in/i);
    expect(NOT_A_LEARNER_MESSAGE).not.toMatch(/example\.test|password/i);
  });
});

describe('isUnreachable', () => {
  it('is the request that never got an answer', () => {
    expect(
      isUnreachable(new ApiError({ statusCode: 0, code: NETWORK_ERROR_CODE, message: 'no' })),
    ).toBe(true);
  });

  it('is not a server that answered and refused', () => {
    // A 500 wants a retry. A page that could not ask anything wants a different address, and
    // telling it "try again" is how a reader concludes the product is dead.
    expect(isUnreachable(new ApiError({ statusCode: 500, code: 'INTERNAL', message: 'no' }))).toBe(
      false,
    );
    expect(isUnreachable(new Error('boom'))).toBe(false);
    expect(isUnreachable(undefined)).toBe(false);
  });
});
