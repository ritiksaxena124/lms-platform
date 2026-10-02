import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignedClass } from '@lms/shared';

import { setAccessToken } from './api';
import { myAssignedClasses } from './cohort-classes';

const BASE_URL = 'http://api.localtest.me:4000';

const ASSIGNED: AssignedClass = {
  id: 'o1',
  course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
  startsAt: '2026-09-28T04:00:00.000Z',
  endsAt: '2026-09-28T04:45:00.000Z',
  durationMinutes: 45,
  status: null,
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

let fetchMock: ReturnType<typeof vi.fn>;

function callAt(index: number): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  setAccessToken(null);
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      jsonResponse({
        from: '2026-09-28T03:00:00.000Z',
        to: '2026-10-28T03:00:00.000Z',
        items: [ASSIGNED],
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('assigned class client', () => {
  it('reads the classes through the session, because they are this person’s calendar', async () => {
    setAccessToken('a-token');

    await expect(myAssignedClasses()).resolves.toEqual([ASSIGNED]);

    expect(callAt(0).url).toBe(`${BASE_URL}/api/v1/classes/learning`);
    expect((callAt(0).init.headers as Record<string, string>).authorization).toBe('Bearer a-token');
  });

  it('asks for no window, because the horizon the sweep keeps is the platform’s answer', async () => {
    await myAssignedClasses();

    expect(callAt(0).url).not.toContain('?');
  });

  it('hands back an empty calendar as an empty list, not as a missing one', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ from: '2026-09-28T03:00:00.000Z', to: '2026-10-28T03:00:00.000Z', items: [] }),
    );

    await expect(myAssignedClasses()).resolves.toEqual([]);
  });

  it('keeps the mark a teacher made on the row it belongs to', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        from: '2026-09-28T03:00:00.000Z',
        to: '2026-10-28T03:00:00.000Z',
        items: [{ ...ASSIGNED, status: 'present' }],
      }),
    );

    await expect(myAssignedClasses()).resolves.toEqual([{ ...ASSIGNED, status: 'present' }]);
  });
});
