import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_ERROR_CODES } from '@lms/shared';

import { setAccessToken } from './api';
import { heldPlaces, leavePlace, myPlaces, payForPlace, takePlace } from './enrollments';

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

/** A place whose money has not arrived: the row is closed *and* there is an attempt standing.
 * `isActive: false` alone cannot tell this from a place somebody left, which is the whole reason
 * the two halves travel together. */
const HELD = { ...PLACE, isActive: false };

/** The attempt beside it, in the shape the API files it before anybody has been asked. */
const OWED = {
  id: '9c1f4d20-0000-4000-8000-000000000001',
  amountMinorUnits: 499900,
  currency: 'INR',
  status: 'pending',
  providerReference: null,
  error: null,
};

/** The same attempt after a charge that came back. */
const PAID = {
  ...OWED,
  status: 'completed',
  providerReference: 'mock-9c1f4d20-0000-4000-8000-000000000001',
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

/**
 * The read that survives a reload.
 *
 * `myPlaces` cannot answer "did I already ask for this one?" — it is a list of links, and a place
 * waiting on money opens nothing. A portal that read only that list lost the hold its own button had
 * just created, and the student's only way back to the amount they were quoted was to press again.
 */
describe('heldPlaces', () => {
  it('reads the places that are shut behind money, with the attempt beside each', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ enrollment: HELD, payment: OWED }] }));

    await expect(heldPlaces()).resolves.toEqual([{ enrollment: HELD, payment: OWED }]);
    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments/held`);
  });

  it('asks who is calling, because a hold is a fact about the person who asked', async () => {
    setAccessToken('at-9');

    await heldPlaces();

    const headers = requestAt(0).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer at-9');
    expect(requestAt(0).credentials).toBe('include');
  });

  it('keeps a refusal a refusal, since the screen has nothing to do with a hold it cannot hear', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 403, code: API_ERROR_CODES.FORBIDDEN, message: 'Not allowed.' },
        403,
      ),
    );

    await expect(heldPlaces()).rejects.toMatchObject({ code: API_ERROR_CODES.FORBIDDEN });
  });
});

describe('takePlace', () => {
  it('offers the course and nothing else, because the session is the student', async () => {
    setAccessToken('at-9');
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrollment: PLACE, payment: null }));

    await expect(takePlace('b2a1')).resolves.toEqual({ enrollment: PLACE, payment: null });

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments`);
    expect(requestAt(0).method).toBe('POST');
    expect(bodyAt(0)).toEqual({ courseId: 'b2a1' });
  });

  it('keeps the attempt beside the place, because a closed row is two different stories', async () => {
    // A priced course answers with a place that has not opened and the money that has not
    // arrived. The screen cannot offer the pay step from the enrollment alone — `isActive:
    // false` is also what leaving looks like — so dropping this half of the answer would leave
    // a student holding a place they are told they do not have.
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrollment: HELD, payment: OWED }));

    await expect(takePlace('b2a1')).resolves.toEqual({ enrollment: HELD, payment: OWED });
  });

  it('says it is sending JSON, so the API validates a body rather than an empty one', async () => {
    await takePlace('b2a1');

    const headers = requestAt(0).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('presses twice without asking anything different', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ enrollment: PLACE, payment: null }));

    // The API answers a second press with the place that already exists and the same `200`,
    // so the portal has no "already enrolled" case to interpret. A double-click on a slow
    // connection is the reason this is a contract rather than a hope.
    await expect(takePlace('b2a1')).resolves.toEqual({ enrollment: PLACE, payment: null });
    await expect(takePlace('b2a1')).resolves.toEqual({ enrollment: PLACE, payment: null });

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

describe('payForPlace', () => {
  it('presses the place it was given and offers no number of its own', async () => {
    setAccessToken('at-9');
    fetchMock.mockResolvedValueOnce(jsonResponse({ enrollment: PLACE, payment: PAID }));

    await expect(payForPlace(PLACE.id)).resolves.toEqual({ enrollment: PLACE, payment: PAID });

    // The address is the place's, never the attempt's: a student acts on the course they asked
    // for, and a payment row is not something this portal gets to name.
    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments/e7f2/pay`);
    expect(requestAt(0).method).toBe('POST');
    // The amount is what this platform already wrote on its own ledger row. A body here would
    // be a student choosing their own price.
    expect(requestAt(0).body).toBeUndefined();
    const headers = requestAt(0).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer at-9');
    expect(requestAt(0).credentials).toBe('include');
  });

  it('encodes the id it was given rather than trusting it as a path', async () => {
    await payForPlace('e7/2');

    expect(urlAt(0)).toBe(`${BASE_URL}/api/v1/enrollments/e7%2F2/pay`);
  });

  it('reports a refused charge as the answer it is, because the place did move', async () => {
    // A gateway that says no answers `200` with the attempt marked `failed`: the row went from
    // waiting to refused, and the screen has to show the reason beside a retry. Throwing here
    // would throw away the amount and the line the ledger already holds.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        enrollment: HELD,
        payment: { ...OWED, status: 'failed', error: 'The card was declined.' },
      }),
    );

    await expect(payForPlace(PLACE.id)).resolves.toMatchObject({
      enrollment: { isActive: false },
      payment: { status: 'failed', error: 'The card was declined.' },
    });
  });

  it('keeps a deployment that takes no money a refusal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 503,
          code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
          message: 'This platform is not wired to take a payment.',
        },
        503,
      ),
    );

    await expect(payForPlace(PLACE.id)).rejects.toMatchObject({
      code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
    });
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
