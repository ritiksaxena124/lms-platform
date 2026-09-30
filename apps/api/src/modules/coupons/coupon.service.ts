import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { DISCOUNT_TYPE_CODES, type DiscountTypeCode } from '@lms/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReferenceService } from '../../reference/reference.service';
import { CouponRepository } from './coupon.repository';
import type { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

/**
 * Business logic for coupons. Validates discount amounts against their types and enforces
 * one active coupon code per course.
 */
@Injectable()
export class CouponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reference: ReferenceService,
    private readonly repository: CouponRepository,
  ) {}

  /** List all coupons for a teacher's course. */
  async listByCourse(courseId: string, teacherUserId: string) {
    const coupons = await this.repository.listByCourse(courseId, teacherUserId);
    return coupons.map((c) => ({
      id: c.id,
      courseId: c.courseId,
      code: c.code,
      discountType: c.discountType.code as DiscountTypeCode,
      discountAmount: c.discountAmount,
      validFrom: c.validFrom?.toISOString() ?? null,
      validUntil: c.validUntil?.toISOString() ?? null,
      maxRedemptions: c.maxRedemptions,
      redemptionCount: c.redemptionCount,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  /** Create a new coupon with validation. */
  async create(courseId: string, teacherUserId: string, input: CreateCouponDto) {
    // Validate discount amount based on type
    this.validateDiscountAmount(input.discountType, input.discountAmount);

    // Look up the discount type ID
    const discountTypeId = await this.reference.valueId('DiscountType', input.discountType);

    try {
      const coupon = await this.repository.create(courseId, teacherUserId, {
        code: input.code.toUpperCase(),
        discountTypeValueId: discountTypeId,
        discountAmount: input.discountAmount,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        maxRedemptions: input.maxRedemptions ?? null,
      });

      return {
        id: coupon.id,
        courseId: coupon.courseId,
        code: coupon.code,
        discountType: coupon.discountType.code as DiscountTypeCode,
        discountAmount: coupon.discountAmount,
        validFrom: coupon.validFrom?.toISOString() ?? null,
        validUntil: coupon.validUntil?.toISOString() ?? null,
        maxRedemptions: coupon.maxRedemptions,
        redemptionCount: coupon.redemptionCount,
        isActive: coupon.isActive,
        createdAt: coupon.createdAt.toISOString(),
        updatedAt: coupon.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        throw new ConflictException('A coupon with this code already exists for this course');
      }
      throw error;
    }
  }

  /** Get a specific coupon by ID. */
  async findById(id: string, teacherUserId: string) {
    const coupon = await this.repository.findById(id, teacherUserId);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    return {
      id: coupon.id,
      courseId: coupon.courseId,
      code: coupon.code,
      discountType: coupon.discountType.code as DiscountTypeCode,
      discountAmount: coupon.discountAmount,
      validFrom: coupon.validFrom?.toISOString() ?? null,
      validUntil: coupon.validUntil?.toISOString() ?? null,
      maxRedemptions: coupon.maxRedemptions,
      redemptionCount: coupon.redemptionCount,
      isActive: coupon.isActive,
      createdAt: coupon.createdAt.toISOString(),
      updatedAt: coupon.updatedAt.toISOString(),
    };
  }

  /** Update a coupon's fields. */
  async update(id: string, teacherUserId: string, input: UpdateCouponDto) {
    // Validate discount amount if provided
    if (input.discountAmount !== undefined) {
      const coupon = await this.repository.findById(id, teacherUserId);
      if (!coupon) {
        throw new NotFoundException('Coupon not found');
      }

      // We need to get the discount type from the existing coupon
      const discountTypeCode = coupon.discountType.code as DiscountTypeCode;
      this.validateDiscountAmount(discountTypeCode, input.discountAmount);
    }

    try {
      const updated = await this.repository.update(id, teacherUserId, {
        code: input.code?.toUpperCase(),
        discountAmount: input.discountAmount,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        maxRedemptions: input.maxRedemptions,
      });

      return {
        id: updated.id,
        courseId: updated.courseId,
        code: updated.code,
        discountType: updated.discountType.code as DiscountTypeCode,
        discountAmount: updated.discountAmount,
        validFrom: updated.validFrom?.toISOString() ?? null,
        validUntil: updated.validUntil?.toISOString() ?? null,
        maxRedemptions: updated.maxRedemptions,
        redemptionCount: updated.redemptionCount,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        throw new ConflictException('A coupon with this code already exists for this course');
      }
      throw error;
    }
  }

  /** Deactivate a coupon. */
  async deactivate(id: string, teacherUserId: string) {
    const deactivated = await this.repository.deactivate(id, teacherUserId);

    return {
      id: deactivated.id,
      courseId: deactivated.courseId,
      code: deactivated.code,
      discountType: deactivated.discountType.code as DiscountTypeCode,
      discountAmount: deactivated.discountAmount,
      validFrom: deactivated.validFrom?.toISOString() ?? null,
      validUntil: deactivated.validUntil?.toISOString() ?? null,
      maxRedemptions: deactivated.maxRedemptions,
      redemptionCount: deactivated.redemptionCount,
      isActive: deactivated.isActive,
      createdAt: deactivated.createdAt.toISOString(),
      updatedAt: deactivated.updatedAt.toISOString(),
    };
  }

  /** Validate a coupon at enrollment time and calculate the discounted price. */
  async validateAndCalculate(
    code: string,
    courseId: string,
    coursePriceMinorUnits: number | null,
    currencyValueId: string | null,
  ) {
    if (!coursePriceMinorUnits || !currencyValueId) {
      return { isValid: false, error: 'Course has no price set' };
    }

    const validation = await this.repository.validateForEnrollment(code, courseId);
    if (!validation.isValid) {
      return validation;
    }

    const coupon = validation.coupon!;
    let discountedAmount: number;

    if (coupon.discountType.code === DISCOUNT_TYPE_CODES.PERCENTAGE) {
      // Percentage discount: reduce by the percentage
      const percentage = Math.min(100, Math.max(0, coupon.discountAmount));
      discountedAmount = Math.round(coursePriceMinorUnits * (1 - percentage / 100));
    } else if (coupon.discountType.code === DISCOUNT_TYPE_CODES.FIXED) {
      // Fixed discount: subtract the amount, but don't go below zero
      discountedAmount = Math.max(0, coursePriceMinorUnits - coupon.discountAmount);
    } else {
      return { isValid: false, error: 'Unknown discount type' };
    }

    return {
      isValid: true,
      coupon: {
        id: coupon.id,
        courseId: coupon.courseId,
        code: coupon.code,
        discountType: coupon.discountType.code as DiscountTypeCode,
        discountAmount: coupon.discountAmount,
        validFrom: coupon.validFrom?.toISOString() ?? null,
        validUntil: coupon.validUntil?.toISOString() ?? null,
        maxRedemptions: coupon.maxRedemptions,
        redemptionCount: coupon.redemptionCount,
        isActive: coupon.isActive,
        createdAt: coupon.createdAt.toISOString(),
        updatedAt: coupon.updatedAt.toISOString(),
      },
      discountedAmount,
    };
  }

  /** Increment redemption count within a transaction. */
  async incrementRedemption(couponId: string, tx: PrismaClient) {
    return this.repository.incrementRedemption(couponId, tx);
  }

  /** Validate discount amount based on type. */
  private validateDiscountAmount(type: DiscountTypeCode, amount: number) {
    if (type === DISCOUNT_TYPE_CODES.PERCENTAGE) {
      if (amount < 0 || amount > 100) {
        throw new BadRequestException('Percentage discount must be between 0 and 100');
      }
    } else if (type === DISCOUNT_TYPE_CODES.FIXED) {
      if (amount < 0) {
        throw new BadRequestException('Fixed discount amount cannot be negative');
      }
    }
  }
}
