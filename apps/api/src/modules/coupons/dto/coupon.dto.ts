import {
  DISCOUNT_TYPE_CODES,
  type DiscountTypeCode,
} from '@lms/shared';
import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsInt,
  Min,
  IsOptional,
  IsISO8601,
} from 'class-validator';

/** Input for creating a new coupon. */
export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsIn([DISCOUNT_TYPE_CODES.PERCENTAGE, DISCOUNT_TYPE_CODES.FIXED])
  discountType!: DiscountTypeCode;

  @IsInt()
  @Min(0)
  discountAmount!: number;

  @IsOptional()
  @IsISO8601()
  validFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;
}

/** Fields that can be updated on an existing coupon. */
export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsISO8601()
  validFrom?: string | null;

  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;
}

/** Response envelope for a single coupon. */
export interface CouponResponse {
  coupon: {
    id: string;
    courseId: string;
    code: string;
    discountType: DiscountTypeCode;
    discountAmount: number;
    validFrom: string | null;
    validUntil: string | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

/** Response envelope for listing coupons. */
export interface CouponListResponse {
  items: Array<{
    id: string;
    courseId: string;
    code: string;
    discountType: DiscountTypeCode;
    discountAmount: number;
    validFrom: string | null;
    validUntil: string | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
}
