import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingRequest } from '@lms/shared';

import { confirmRequest, joinRoom, listClasses, listRequests, refuseRequest } from './bookings';

const BASE_URL = 'http://api.localtest.me:4000';

const REQUEST: BookingRequest = {
  id: 'b1',
  course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
  type: 'enrolled',
  status: 'pending',
  live: null,
  startsAt: '2026-10-01T09:00:00.000Z',
  endsAt: '2026-10-01T09:45:00.000Z',
  durationMinutes: 45,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  student: { id: 's1', displayName: 'Rohan Mehta' },
};

/** A request the teacher said yes to: the minute stays held and the class now has a door, which
 * opens five minutes before the first minute and stays open a quarter of an hour after the last. */
const ANSWERED: BookingRequest = {
  ...REQUEST,
  status: 'confirmed',
  live: { opensAt: '2026-10-01T08:55:00.000Z', closesAt: '2026-10-01T10:00:00.000Z' },
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
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ booking: ANSWERED }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('booking request client', () => {
  it('reads the queue through the account, because a request is addressed to a person', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ requests: [REQUEST] }));

    await expect(listRequests()).resolves.toEqual([REQUEST]);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/bookings/requests`,
      method: 'GET',
    });
  });

  it('reads the class list as one route of its own, because it is not the queue', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ bookings: [REQUEST] }));

    await expect(listClasses()).resolves.toEqual([REQUEST]);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/bookings/classes`,
      method: 'GET',
    });
  });

  it('hands the whole list back unfiltered, because every status is a fact about the schedule', async () => {
    // The teacher's list holds answered, cancelled and expired classes beside the waiting ones.
    // Deciding what counts as "upcoming" belongs to the screen, which is the only place that
    // knows the split the person reading it wants.
    const past: BookingRequest = { ...REQUEST, id: 'b2', status: 'completed' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ bookings: [past, REQUEST] }));

    await expect(listClasses()).resolves.toEqual([past, REQUEST]);
  });

  it('confirms by id alone, with nothing in the body to disagree with the session', async () => {
    await confirmRequest('b1');

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/bookings/b1/confirm`,
      method: 'POST',
    });
    expect(requestAt(0).body).toBeUndefined();
  });

  it('refuses through its own route, because a no is a decision rather than an edit', async () => {
    await refuseRequest('b1');

    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/bookings/b1/reject`,
      method: 'POST',
    });
    expect(requestAt(0).body).toBeUndefined();
  });

  it('escapes an id it did not write, so a stored value cannot reach for another route', async () => {
    await confirmRequest('b1/confirm');

    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/bookings/b1%2Fconfirm/confirm`);
  });

  it('hands back the conflict with the message that says refresh, so the screen can offer it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'This class changed while you were deciding. Refresh to see it.',
        },
        409,
      ),
    );

    await expect(confirmRequest('b1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This class changed while you were deciding. Refresh to see it.',
    });
  });
});

/**
 * The room is asked for, never carried.
 *
 * A Jitsi room has no password — its address is the whole key — so the class list deliberately
 * leaves it off and this call hands it out to one person who has just been checked (ARCHITECTURE
 * §6). A client that could `GET` it would be a client a browser could prefetch.
 */
describe('joinRoom', () => {
  it('posts for the address and takes the address back', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ room: { url: 'https://meet.localtest.me/veena-0f2c' } }),
    );

    await expect(joinRoom('b1')).resolves.toBe('https://meet.localtest.me/veena-0f2c');
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/bookings/b1/room`,
      method: 'POST',
    });
    expect(requestAt(0).body).toBeUndefined();
  });

  it('escapes the class it asks about, like every other booking route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ room: { url: 'https://meet.localtest.me/x' } }));

    await joinRoom('b1/room');

    expect(requestAt(0).url).toBe(`${BASE_URL}/api/v1/bookings/b1%2Froom/room`);
  });

  it('hands back the reason a door stayed shut, so the row can say it out loud', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: "This class's room is not open yet.",
          details: { opensAt: '2026-10-01T08:55:00.000Z' },
        },
        409,
      ),
    );

    await expect(joinRoom('b1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: "This class's room is not open yet.",
    });
  });
});
