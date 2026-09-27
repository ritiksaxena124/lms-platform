import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES, SLOT_DENIAL_CODES, SLOT_ENTITLEMENT_CODES } from '@lms/shared';

import { setAccessToken } from './api';
import { bookSlot, leaveClass, myBookings, openSlotsFor } from './bookings';

const BASE_URL = 'http://api.localtest.me:4000';

const SLOT = { startsAt: '2026-09-28T04:00:00.000Z', endsAt: '2026-09-28T04:45:00.000Z' };

const BOOKING = {
  id: '6a27',
  course: { id: 'b2a1', slug: 'fractions-the-slow-way', title: 'Fractions, the slow way' },
  type: 'enrolled',
  status: 'pending',
  startsAt: SLOT.startsAt,
  endsAt: SLOT.endsAt,
  durationMinutes: 45,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

function callAt(index: number): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`only ${fetchMock.mock.calls.length} request(s) were made`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function bodyAt(index: number): unknown {
  const body = callAt(index).init.body;
  return typeof body === 'string' && body !== '' ? JSON.parse(body) : undefined;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = BASE_URL;
  setAccessToken(null);
  fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      course: { id: 'b2a1', slug: 'fractions-the-slow-way', title: 'Fractions', demoBookingsEnabled: true },
      teacher: { id: 't1', timezone: 'Asia/Kolkata' },
      entitlement: SLOT_ENTITLEMENT_CODES.ENROLLED,
      denial: null,
      from: '2026-09-27T00:00:00.000Z',
      to: '2026-10-27T00:00:00.000Z',
      slots: [SLOT],
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('openSlotsFor', () => {
  it('names one course in the query, encoded rather than trusted as a URL', async () => {
    await openSlotsFor('fractions/the slow way');

    expect(callAt(0).url).toBe(
      `${BASE_URL}/api/v1/bookings/slots?course=fractions%2Fthe%20slow%20way`,
    );
  });

  it('asks who is calling, because the grid depends on the answer', async () => {
    setAccessToken('at-9');

    await openSlotsFor('b2a1');

    const headers = callAt(0).init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer at-9');
    expect(callAt(0).init.credentials).toBe('include');
  });

  it('hands back a refusal to book as a list with a reason, not as an error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        course: { id: 'b2a1', slug: 'fractions', title: 'Fractions', demoBookingsEnabled: false },
        teacher: { id: 't1', timezone: 'Asia/Kolkata' },
        entitlement: SLOT_ENTITLEMENT_CODES.NONE,
        denial: SLOT_DENIAL_CODES.ENROLLMENT_REQUIRED,
        from: '2026-09-27T00:00:00.000Z',
        to: '2026-10-27T00:00:00.000Z',
        slots: [],
      }),
    );

    // An empty grid is a `200` on purpose: "enroll first" and "you already used your trial
    // call" are two screens, and a client that threw on both could not tell them apart.
    await expect(openSlotsFor('b2a1')).resolves.toMatchObject({
      entitlement: SLOT_ENTITLEMENT_CODES.NONE,
      denial: SLOT_DENIAL_CODES.ENROLLMENT_REQUIRED,
    });
  });

  it('passes through the teacher zone and the horizon untouched', async () => {
    const response = await openSlotsFor('b2a1');

    expect(response.teacher.timezone).toBe('Asia/Kolkata');
    expect(response.from).toBe('2026-09-27T00:00:00.000Z');
    expect(response.slots).toEqual([SLOT]);
  });
});

describe('bookSlot', () => {
  it('offers a course and one minute, and nothing that belongs to somebody else', async () => {
    setAccessToken('at-9');
    fetchMock.mockResolvedValueOnce(jsonResponse({ booking: BOOKING }));

    await expect(bookSlot('b2a1', SLOT.startsAt)).resolves.toEqual(BOOKING);

    expect(callAt(0).url).toBe(`${BASE_URL}/api/v1/bookings`);
    expect(callAt(0).init.method).toBe('POST');
    expect(bodyAt(0)).toEqual({ course: 'b2a1', startsAt: SLOT.startsAt });
  });

  it('answers a second press with the same class, so a double click is not two outcomes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ booking: BOOKING }));

    await bookSlot('b2a1', SLOT.startsAt);
    await bookSlot('b2a1', SLOT.startsAt);

    expect(bodyAt(1)).toEqual(bodyAt(0));
  });

  it('keeps a taken minute a conflict the screen can act on', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 409, code: API_ERROR_CODES.CONFLICT, message: 'That minute went.' },
        409,
      ),
    );

    await expect(bookSlot('b2a1', SLOT.startsAt)).rejects.toMatchObject({
      code: API_ERROR_CODES.CONFLICT,
    });
  });
});

describe('myBookings', () => {
  it('reads one list from the person, with no course to narrow it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ bookings: [BOOKING] }));

    await expect(myBookings()).resolves.toEqual([BOOKING]);
    expect(callAt(0).url).toBe(`${BASE_URL}/api/v1/bookings`);
  });

  it('keeps the order the API answered with', async () => {
    const later = { ...BOOKING, id: '9253', startsAt: '2026-10-02T04:00:00.000Z' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ bookings: [BOOKING, later] }));

    await expect(myBookings()).resolves.toEqual([BOOKING, later]);
  });
});

describe('leaveClass', () => {
  it('names the class in the path and sends nothing to get wrong', async () => {
    setAccessToken('at-9');
    const stood = { ...BOOKING, status: 'cancelled' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ booking: stood }));

    await expect(leaveClass('6a27')).resolves.toEqual(stood);

    expect(callAt(0).url).toBe(`${BASE_URL}/api/v1/bookings/6a27/cancel`);
    expect(callAt(0).init.method).toBe('POST');
    expect(bodyAt(0)).toBeUndefined();
    expect((callAt(0).init.headers as Record<string, string>).authorization).toBe('Bearer at-9');
  });

  it('keeps an id from the URL inside the path it belongs to', async () => {
    await leaveClass('../../admin');

    expect(callAt(0).url).toBe(`${BASE_URL}/api/v1/bookings/..%2F..%2Fadmin/cancel`);
  });

  it('carries back a class that is no longer standing as a conflict', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 409,
          code: API_ERROR_CODES.CONFLICT,
          message: 'This class is not standing, so there is nothing to cancel.',
        },
        409,
      ),
    );

    await expect(leaveClass('6a27')).rejects.toMatchObject({
      code: API_ERROR_CODES.CONFLICT,
    });
  });
});
