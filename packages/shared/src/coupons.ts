/**
 * Shared types for coupons and payments — the vocabulary both portals and the API agree on.
 */

import type { DiscountTypeCode } from './lookup-codes';

/** A discount code a teacher issues for one of their courses. */
export interface Coupon {
  id: string;
  courseId: string;
  code: string;
  discountType: DiscountTypeCode;
  discountAmount: number;
  validFrom: string | null; // ISO 8601 datetime or null (immediately)
  validUntil: string | null; // ISO 8601 datetime or null (never expires)
  maxRedemptions: number | null;
  redemptionCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating or updating a coupon. All fields optional except `code` and `discountType`. */
export interface CouponInput {
  code: string;
  discountType: DiscountTypeCode;
  discountAmount: number;
  validFrom?: string | null;
  validUntil?: string | null;
  maxRedemptions?: number | null;
}

/** The result of validating a coupon at enrollment time. */
export interface CouponValidationResult {
  isValid: boolean;
  coupon?: Coupon;
  discountedAmount?: number; // Final price in minor units after discount
  error?: string; // Human-readable reason if invalid
}

/** Response envelope for a single coupon. */
export interface CouponResponse {
  coupon: Coupon;
}

/** Response envelope for listing coupons. */
export interface CouponListResponse {
  items: Coupon[];
}
