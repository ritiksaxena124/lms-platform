import type { Coupon, CouponListResponse, CouponResponse } from '@lms/shared';
import { apiJson } from './api';

/**
 * The discount codes one course carries.
 *
 * The API answers every route through an envelope — `{ items }` for the list, `{ coupon }` for a
 * write — so each call unwraps here rather than passing the wrapper to a screen that wants rows.
 * Deactivation is its own endpoint so an edit cannot smuggle an `isActive` change beside new numbers.
 */

export async function listCoupons(courseId: string): Promise<Coupon[]> {
  const { items } = await apiJson<CouponListResponse>(`/courses/${courseId}/coupons`, {
    method: 'GET',
  });
  return items;
}

export async function createCoupon(
  courseId: string,
  input: {
    code: string;
    discountType: 'percentage' | 'fixed';
    discountAmount: number;
    validFrom?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
  },
): Promise<Coupon> {
  const { coupon } = await apiJson<CouponResponse>(`/courses/${courseId}/coupons`, {
    method: 'POST',
    body: input,
  });
  return coupon;
}

export async function updateCoupon(
  courseId: string,
  couponId: string,
  input: {
    code?: string;
    discountAmount?: number;
    validFrom?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
  },
): Promise<Coupon> {
  const { coupon } = await apiJson<CouponResponse>(`/courses/${courseId}/coupons/${couponId}`, {
    method: 'PATCH',
    body: input,
  });
  return coupon;
}

export async function deactivateCoupon(courseId: string, couponId: string): Promise<Coupon> {
  const { coupon } = await apiJson<CouponResponse>(
    `/courses/${courseId}/coupons/${couponId}/deactivate`,
    { method: 'POST' },
  );
  return coupon;
}
