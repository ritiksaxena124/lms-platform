import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCoupon, deactivateCoupon, listCoupons, updateCoupon } from './coupons';

const BASE_URL = 'http://api.localtest.me:4000';

const COUPON = {
  id: 'cp1',
  courseId: 'c1',
  code: 'WELCOME10',
  discountType: 'percentage',
  discountAmount: 10,
  validFrom: null,
  validUntil: null,
  maxRedemptions: 50,
  redemptionCount: 2,
  isActive: true,
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-20T09:00:00.000Z',
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
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [COUPON] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('coupon client', () => {
  it('hands back the rows, not the envelope the API wraps them in', async () => {
    await expect(listCoupons('c1')).resolves.toEqual([COUPON]);
    expect(requestAt(0)).toMatchObject({
      url: `${BASE_URL}/api/v1/courses/c1/coupons`,
      method: 'GET',
    });
  });

  it('unwraps the coupon each write answers with', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ coupon: COUPON }));

    await expect(
      createCoupon('c1', { code: 'WELCOME10', discountType: 'percentage', discountAmount: 10 }),
    ).resolves.toEqual(COUPON);
    await expect(updateCoupon('c1', 'cp1', { discountAmount: 20 })).resolves.toEqual(COUPON);
    await expect(deactivateCoupon('c1', 'cp1')).resolves.toEqual(COUPON);

    expect(requestAt(0).method).toBe('POST');
    expect(requestAt(1)).toMatchObject({ url: `${BASE_URL}/api/v1/courses/c1/coupons/cp1` });
    expect(requestAt(2).url).toBe(`${BASE_URL}/api/v1/courses/c1/coupons/cp1/deactivate`);
  });

  it('hands the body over once-encoded, so the API reads an object and not a string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ coupon: COUPON }));

    await createCoupon('c1', { code: 'WELCOME10', discountType: 'percentage', discountAmount: 10 });

    // `apiJson` stringifies what it is given. A caller that stringifies first sends the API a
    // JSON *string*, which the body parser refuses before any rule about coupons is reached.
    expect(JSON.parse(requestAt(0).body ?? '')).toEqual({
      code: 'WELCOME10',
      discountType: 'percentage',
      discountAmount: 10,
    });
  });

  it('hands a refusal back intact, so the screen can name the code it rejected', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 409,
          code: 'CONFLICT',
          message: 'That code is already taken on this course.',
        },
        409,
      ),
    );

    await expect(
      createCoupon('c1', { code: 'WELCOME10', discountType: 'percentage', discountAmount: 10 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
