import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { courseRoster } from './roster';

const BASE_URL = 'http://api.localtest.me:4000';

const PAGE = {
  items: [
    { student: { id: 's1', fullName: 'Sima Kundu' }, enrolledAt: '2026-09-21T09:30:00.000Z' },
  ],
  page: 1,
  pageSize: 25,
  total: 1,
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

let fetchMock: ReturnType<typeof vi.fn>;

function requestAt(index: number): { url: string; method: string; body?: string } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  const init = (call[1] ?? {}) as RequestInit;
  return {
    url: String(call[0]),
    method: String(init.method ?? 'GET'),
    body: init.body as string | undefined,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn().mockResolvedValue(jsonResponse(PAGE));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('roster client', () => {
  it('reads a course’s class through the course, because ownership is the permission', async () => {
    await expect(courseRoster('c1')).resolves.toEqual(PAGE);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/courses/c1/roster`,
      method: 'GET',
    });
  });

  it('asks for a page by number, and sends no filter it has no business guessing', async () => {
    await courseRoster('c1', 3);

    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/courses/c1/roster?page=3`);
  });

  it('hands back the whole envelope, because the headcount is not the rows on a page', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...PAGE, page: 2, pageSize: 25, total: 31 }));

    await expect(courseRoster('c1', 2)).resolves.toMatchObject({ page: 2, total: 31 });
  });

  it('hands a refusal back intact, so the screen can say a course was not found', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 404, code: 'NOT_FOUND', message: 'We cannot find that course.' },
        404,
      ),
    );

    await expect(courseRoster('c1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'We cannot find that course.',
    });
  });
});
