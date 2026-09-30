import type { Coupon } from '@lms/shared';
import { apiJson } from './api';

/** List all coupons for a course. */
export async function listCoupons(courseId: string) {
  return apiJson<Coupon[]>(`/courses/${courseId}/coupons`, {
    method: 'GET',
  });
}

/** Create a new coupon for a course. */
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
) {
  return apiJson<Coupon>(`/courses/${courseId}/coupons`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Update an existing coupon. */
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
) {
  return apiJson<Coupon>(`/courses/${courseId}/coupons/${couponId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Deactivate a coupon. */
export async function deactivateCoupon(courseId: string, couponId: string) {
  return apiJson<Coupon>(`/courses/${courseId}/coupons/${couponId}/deactivate`, {
    method: 'POST',
  });
}
