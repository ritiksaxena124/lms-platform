import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Data access for coupons. All writes are teacher-gated through course ownership, and a
 * coupon can only be created for a course the calling teacher owns.
 */
@Injectable()
export class CouponRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** List all active coupons for a course the teacher owns. */
  async listByCourse(courseId: string, teacherUserId: string) {
    // Verify ownership first
    const course = await this.prisma.course.findUnique({
      where: { id: courseId, teacherUserId, isActive: true },
      select: { id: true },
    });

    if (!course) {
      throw new Error('Course not found or not owned by this teacher');
    }

    return this.prisma.coupon.findMany({
      where: { courseId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: {
        discountType: { select: { code: true } },
      },
    });
  }

  /** Create a new coupon for a course the teacher owns. */
  async create(
    courseId: string,
    teacherUserId: string,
    data: {
      code: string;
      discountTypeValueId: string;
      discountAmount: number;
      validFrom?: string | null;
      validUntil?: string | null;
      maxRedemptions?: number | null;
    },
  ) {
    // Verify ownership
    const course = await this.prisma.course.findUnique({
      where: { id: courseId, teacherUserId, isActive: true },
      select: { id: true },
    });

    if (!course) {
      throw new Error('Course not found or not owned by this teacher');
    }

    return this.prisma.coupon.create({
      data: {
        courseId,
        ...data,
      },
      include: {
        discountType: { select: { code: true } },
      },
    });
  }

  /** Get a specific coupon by ID, verifying it belongs to a course the teacher owns. */
  async findById(id: string, teacherUserId: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        id,
        course: { teacherUserId, isActive: true },
      },
      include: {
        discountType: { select: { code: true } },
      },
    });

    return coupon;
  }

  /** Update a coupon's fields (code, amounts, validity windows). */
  async update(
    id: string,
    teacherUserId: string,
    data: {
      code?: string;
      discountAmount?: number;
      validFrom?: string | null;
      validUntil?: string | null;
      maxRedemptions?: number | null;
    },
  ) {
    const existing = await this.findById(id, teacherUserId);
    if (!existing) {
      throw new Error('Coupon not found or not accessible');
    }

    return this.prisma.coupon.update({
      where: { id },
      data,
      include: {
        discountType: { select: { code: true } },
      },
    });
  }

  /** Deactivate a coupon (soft delete). */
  async deactivate(id: string, teacherUserId: string) {
    const existing = await this.findById(id, teacherUserId);
    if (!existing) {
      throw new Error('Coupon not found or not accessible');
    }

    return this.prisma.coupon.update({
      where: { id },
      data: { isActive: false },
      include: {
        discountType: { select: { code: true } },
      },
    });
  }

  /** Validate a coupon for enrollment: check existence, validity window, usage limits. */
  async validateForEnrollment(code: string, courseId: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code,
        courseId,
        isActive: true,
      },
      include: {
        discountType: { select: { code: true } },
      },
    });

    if (!coupon) {
      return { isValid: false, error: 'Coupon not found' };
    }

    // Check validity window
    const now = new Date();
    if (coupon.validFrom && new Date(coupon.validFrom) > now) {
      return { isValid: false, error: 'Coupon is not yet valid' };
    }
    if (coupon.validUntil && new Date(coupon.validUntil) < now) {
      return { isValid: false, error: 'Coupon has expired' };
    }

    // Check usage limit
    if (coupon.maxRedemptions !== null && coupon.redemptionCount >= coupon.maxRedemptions) {
      return { isValid: false, error: 'Coupon has reached its redemption limit' };
    }

    return { isValid: true, coupon };
  }

  /** Increment the redemption count for a coupon (called within a transaction during enrollment). */
  async incrementRedemption(id: string, tx: PrismaClient) {
    return tx.coupon.update({
      where: { id },
      data: { redemptionCount: { increment: 1 } },
    });
  }
}
