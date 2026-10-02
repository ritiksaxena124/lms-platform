import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeachingClassesResponse } from '@lms/shared';

import { myTeachingClasses } from './cohort-classes';

const BASE_URL = 'http://api.localtest.me:4000';

const WEEK: TeachingClassesResponse = {
  from: '2026-09-28T03:00:00.000Z',
  to: '2026-10-28T03:00:00.000Z',
  items: [
    {
      id: 'o1',
      seriesId: 's1',
      course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
      startsAt: '2026-09-28T04:00:00.000Z',
      endsAt: '2026-09-28T04:45:00.000Z',
      durationMinutes: 45,
      studentsExpected: 6,
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

let fetchMock: ReturnType<typeof vi.fn>;

function requestAt(index: number): { url: string; method: string } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  const init = (call[1] ?? {}) as RequestInit;
  return { url: String(call[0]), method: String(init.method ?? 'GET') };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  fetchMock = vi.fn().mockResolvedValue(jsonResponse(WEEK));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('teaching calendar client', () => {
  it('reads the dated classes through the account, because the session is the teacher', async () => {
    await expect(myTeachingClasses()).resolves.toEqual(WEEK);

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/classes/teaching`,
      method: 'GET',
    });
  });

  it('asks for no window, because the calendar it can stand behind is the platform’s answer', async () => {
    // The sweep keeps a horizon, not this screen. A client that guessed at thirty days would put a
    // second copy of that number in the portal, and the two would drift apart.
    await myTeachingClasses();

    expect(requestAt(0).url).not.toContain('?');
  });

  it('hands back the bounds with the rows, because an empty week has two different reasons', async () => {
    const empty: TeachingClassesResponse = { from: WEEK.from, to: WEEK.to, items: [] };
    fetchMock.mockResolvedValueOnce(jsonResponse(empty));

    await expect(myTeachingClasses()).resolves.toEqual(empty);
  });

  it('hands back the reason the calendar stayed shut, so the screen can say it out loud', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Only a teacher reads a teaching calendar.',
        },
        403,
      ),
    );

    await expect(myTeachingClasses()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Only a teacher reads a teaching calendar.',
    });
  });
});
