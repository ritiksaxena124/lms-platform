import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES } from '@lms/shared';

import { setAccessToken } from './api';
import { leavePlace, myPlaces, takePlace } from './enrollments';

const BASE_URL = 'http://api.localtest.me:4000';

const PLACE = {
  id: 'e7f2',
  course: {
    id: 'b2a1',
    slug: 'algebra-for-the-cbse-boards',
    title: 'Algebra for the CBSE boards',
  },
  isActive: true,
  enrolledAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

function requestAt(index: number): RequestInit {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return (call[1] ?? {}) as RequestInit;
}

function urlAt(index: number): string {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return String(call[0]);
}

function bodyAt(index: number): unknown {
  const body = requestAt(index).body;
  return typeof body === 'string' && body !== '' ? JSON.parse(body) : undefined;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  // A token left over from another test would make "sends the session" pass for the wrong
  // reason, since the flag is what decides whether the header is offered at all.
  setAccessToken(null);
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('myPlaces', () => {
  it('reads the roster as one list, because a student is not browsing a shelf', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [PLACE] }));

    await expect(myPlaces()).resolves.toEqual([PLACE]);
    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments`);
  });

  it('asks who is calling, with the token the tab holds and the cookie beside it', async () => {
    setAccessToken('at-9');

    await myPlaces();

    const headers = requestAt(0).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer at-9');
    expect(requestAt(0).credentials).toBe('include');
  });

  it('keeps a refusal a refusal, since the screen has nothing to do with a roster that failed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 403, code: API_ERROR_CODES.FORBIDDEN, message: 'Not allowed.' },
        403,
      ),
    );

    await expect(myPlaces()).rejects.toMatchObject({ code: API_ERROR_CODES.FORBIDDEN });
  });
});

describe('takePlace', () => {
  it('offers the course and nothing else, because the session is the student', async () => {
    setAccessToken('at-9');
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrollment: PLACE }));

    await expect(takePlace('b2a1')).resolves.toEqual(PLACE);

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments`);
    expect(requestAt(0).method).toBe('POST');
    expect(bodyAt(0)).toEqual({ courseId: 'b2a1' });
  });

  it('says it is sending JSON, so the API validates a body rather than an empty one', async () => {
    await takePlace('b2a1');

    const headers = requestAt(0).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('presses twice without asking anything different', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ enrollment: PLACE }));

    // The API answers a second press with the place that already exists and the same `200`,
    // so the portal has no "already enrolled" case to interpret. A double-click on a slow
    // connection is the reason this is a contract rather than a hope.
    await expect(takePlace('b2a1')).resolves.toEqual(PLACE);
    await expect(takePlace('b2a1')).resolves.toEqual(PLACE);

    expect(bodyAt(0)).toEqual(bodyAt(1));
    expect(urlAt(1)).toBe(urlAt(0));
  });

  it('reports a course that closed for the same reason it never existed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 404,
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'We cannot find that course.',
        },
        404,
      ),
    );

    // A draft, a retired course and a wrong id are one answer here too: the API will not
    // publish a list of courses that exist but cannot be joined.
    await expect(takePlace('b2a1')).rejects.toMatchObject({ code: API_ERROR_CODES.NOT_FOUND });
  });
});

describe('leavePlace', () => {
  it('cancels the place by its own id, and not the course behind it', async () => {
    setAccessToken('at-9');
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrollment: { ...PLACE, isActive: false } }));

    await expect(leavePlace('e7f2')).resolves.toMatchObject({ id: 'e7f2', isActive: false });

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments/e7f2/cancel`);
    expect(requestAt(0).method).toBe('POST');
    expect(requestAt(0).body).toBeUndefined();
  });

  it('encodes the id it was given rather than trusting it as a path', async () => {
    await leavePlace('e7/2');

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments/e7%2F2/cancel`);
  });
});
