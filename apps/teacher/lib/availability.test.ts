import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvailabilityRuleInput } from '@lms/shared';

import { closeWindow, listWindows, moveWindow, openWindow } from './availability';

const BASE_URL = 'http://api.localtest.me:4000';

const MONDAY_MORNING: AvailabilityRuleInput = {
  weekday: 1,
  startMinutes: 540,
  endMinutes: 630,
  slotMinutes: 30,
};

const RULE = {
  id: 'r1',
  ...MONDAY_MORNING,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
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
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rule: RULE }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('availability client', () => {
  it('reads the week through the account, because a window belongs to a person not a course', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [RULE] }));

    await expect(listWindows()).resolves.toEqual([RULE]);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/availability/rules`,
      method: 'GET',
    });
  });

  it('opens a window by naming all four numbers, and never the teacher', async () => {
    await openWindow(MONDAY_MORNING);

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/availability/rules`,
      method: 'POST',
    });
    expect(JSON.parse(requestAt(0).body ?? '{}')).toEqual(MONDAY_MORNING);
  });

  it('sends only the fields a move named, so an untouched box stays untouched', async () => {
    await moveWindow('r1', { endMinutes: 660 });

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/availability/rules/r1`,
      method: 'PATCH',
    });
    expect(JSON.parse(requestAt(0).body ?? '{}')).toEqual({ endMinutes: 660 });
  });

  it('closes a window through its own route, not a flag on an edit', async () => {
    await closeWindow('r1');

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/availability/rules/r1/retire`,
      method: 'POST',
    });
    expect(requestAt(0).body).toBeUndefined();
  });

  it('escapes an id it did not write, so a stored value cannot reach for another route', async () => {
    await moveWindow('r1/retire', { endMinutes: 660 });

    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/availability/rules/r1%2Fretire`);
  });

  it('hands the refusal back with the field it named, so the form can mark that box', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Check the highlighted fields.',
          details: { validation: { startMinutes: ['Monday 09:00–10:30 already has a window.'] } },
        },
        409,
      ),
    );

    await expect(openWindow(MONDAY_MORNING)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { validation: { startMinutes: ['Monday 09:00–10:30 already has a window.'] } },
    });
  });
});
