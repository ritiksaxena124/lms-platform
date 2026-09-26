import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES } from '@lms/shared';

import { ApiError, apiGet, describeFailure } from './api';

const BASE_URL = 'http://api.localtest.me:4000';

function jsonResponse(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

function requestAt(index: number): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
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

  it('carries nothing that identifies the visitor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await apiGet('/catalog/courses');

    const { init } = requestAt(0);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const authKey = Object.keys(headers).find((name) => name.toLowerCase() === 'authorization');
    expect(authKey).toBeUndefined();
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

describe('describeFailure', () => {
  it('has something to show for a failure with no message', () => {
    expect(describeFailure(new ApiError({ statusCode: 500, code: 'X', message: '   '}))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
