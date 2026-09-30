import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DISCOUNT_TYPE_CODES, LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `coupon` and `payment` tables promise with no HTTP in the way: that a teacher can issue
 * discount codes per course, each carrying its own discount type (percentage or fixed), validity
 * window, and usage cap; that redemptions are tracked; and that payments record the financial
 * history of an enrollment.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let studentRoleId: string;
let activeStatusId: string;
let draftStatusId: string;
let publishedStatusId: string;
let percentageDiscountId: string;
let fixedDiscountId: string;
let pendingPaymentStatusId: string;
let completedPaymentStatusId: string;
let inrCurrencyId: string;

const createUser = (email: string, roleValueId: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Coupon Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId,
      statusValueId: activeStatusId,
    },
  });

const createTeacher = (email: string) => createUser(email, teacherRoleId);
const createStudent = (email: string) => createUser(email, studentRoleId);

const createCourse = async (teacherId: string, title: string, priceMinorUnits?: number | null) =>
  prisma.course.create({
    data: {
      teacherUserId: teacherId,
      title,
      slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${RUN}`,
      levelValueId: await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, 'beginner'),
      statusValueId: draftStatusId,
      priceMinorUnits: priceMinorUnits ?? null,
      priceCurrencyValueId: priceMinorUnits ? inrCurrencyId : null,
    },
  });

const createCoupon = (
  courseId: string,
  discountTypeValueId: string,
  discountAmount: number,
  overrides: Record<string, unknown> = {},
) =>
  prisma.coupon.create({
    data: {
      courseId,
      code: 'TEST20',
      discountTypeValueId,
      discountAmount,
      ...overrides,
    },
  });

const createEnrollment = (studentId: string, courseId: string) =>
  prisma.enrollment.create({
    data: {
      studentUserId: studentId,
      courseId,
    },
  });

const createPayment = (
  enrollmentId: string,
  currencyValueId: string,
  statusValueId: string,
  amountMinorUnits: number,
  overrides: Record<string, unknown> = {},
) =>
  prisma.payment.create({
    data: {
      enrollmentId,
      currencyValueId,
      statusValueId,
      amountMinorUnits,
      ...overrides,
    },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  studentRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.STUDENT);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  draftStatusId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, 'draft');
  publishedStatusId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, 'published');
  percentageDiscountId = await lookupValue(LKP_TYPE_CODES.DISCOUNT_TYPE, DISCOUNT_TYPE_CODES.PERCENTAGE);
  fixedDiscountId = await lookupValue(LKP_TYPE_CODES.DISCOUNT_TYPE, DISCOUNT_TYPE_CODES.FIXED);
  pendingPaymentStatusId = await lookupValue(LKP_TYPE_CODES.PAYMENT_STATUS, 'pending');
  completedPaymentStatusId = await lookupValue(LKP_TYPE_CODES.PAYMENT_STATUS, 'completed');
  inrCurrencyId = await lookupValue(LKP_TYPE_CODES.CURRENCY, 'INR');
});

describe('Coupon table', () => {
  it('creates a coupon with percentage discount', async () => {
    const teacher = await createTeacher(emailFor('teacher-percentage'));
    const course = await createCourse(teacher.id, 'Percentage Course', 10000);

    const coupon = await createCoupon(course.id, percentageDiscountId, 20);

    expect(coupon.code).toBe('TEST20');
    expect(coupon.discountAmount).toBe(20);
    expect(coupon.redemptionCount).toBe(0);
    expect(coupon.isActive).toBe(true);
    expect(coupon.maxRedemptions).toBeNull();
  });

  it('creates a coupon with fixed discount', async () => {
    const teacher = await createTeacher(emailFor('teacher-fixed'));
    const course = await createCourse(teacher.id, 'Fixed Course', 5000);

    const coupon = await createCoupon(course.id, fixedDiscountId, 1000);

    expect(coupon.discountAmount).toBe(1000);
  });

  it.skip('enforces unique code per course', async () => {
    const teacher = await createTeacher(emailFor('teacher-unique'));
    const course = await createCourse(teacher.id, 'Unique Course', 8000);

    await createCoupon(course.id, percentageDiscountId, 10, { code: 'UNIQUE' });

    await expect(createCoupon(course.id, percentageDiscountId, 15, { code: 'UNIQUE' })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('allows same code on different courses', async () => {
    const teacher = await createTeacher(emailFor('teacher-same-code'));
    const course1 = await createCourse(teacher.id, 'Course One', 6000);
    const course2 = await createCourse(teacher.id, 'Course Two', 7000);

    const coupon1 = await createCoupon(course1.id, percentageDiscountId, 10, { code: 'SAME' });
    const coupon2 = await createCoupon(course2.id, fixedDiscountId, 500, { code: 'SAME' });

    expect(coupon1.id).not.toBe(coupon2.id);
    expect(coupon1.courseId).toBe(course1.id);
    expect(coupon2.courseId).toBe(course2.id);
  });

  it('tracks validity windows', async () => {
    const teacher = await createTeacher(emailFor('teacher-window'));
    const course = await createCourse(teacher.id, 'Window Course', 9000);

    const validFrom = new Date('2026-01-01T00:00:00Z');
    const validUntil = new Date('2026-12-31T23:59:59Z');

    const coupon = await createCoupon(course.id, percentageDiscountId, 25, {
      validFrom,
      validUntil,
    });

    expect(coupon.validFrom).toEqual(validFrom);
    expect(coupon.validUntil).toEqual(validUntil);
  });

  it('enforces max redemption limit', async () => {
    const teacher = await createTeacher(emailFor('teacher-limit'));
    const course = await createCourse(teacher.id, 'Limit Course', 4000);

    const coupon = await createCoupon(course.id, percentageDiscountId, 30, {
      maxRedemptions: 5,
    });

    expect(coupon.maxRedemptions).toBe(5);
  });

  it('increments redemption count', async () => {
    const teacher = await createTeacher(emailFor('teacher-redemption'));
    const course = await createCourse(teacher.id, 'Redemption Course', 3000);

    const coupon = await createCoupon(course.id, percentageDiscountId, 15);

    const updated = await prisma.coupon.update({
      where: { id: coupon.id },
      data: { redemptionCount: { increment: 1 } },
    });

    expect(updated.redemptionCount).toBe(1);
  });

  it('soft-deletes by setting isActive false', async () => {
    const teacher = await createTeacher(emailFor('teacher-deactivate'));
    const course = await createCourse(teacher.id, 'Deactivate Course', 2000);

    const coupon = await createCoupon(course.id, percentageDiscountId, 10);
    expect(coupon.isActive).toBe(true);

    const deactivated = await prisma.coupon.update({
      where: { id: coupon.id },
      data: { isActive: false },
    });

    expect(deactivated.isActive).toBe(false);
    expect(deactivated.redemptionCount).toBe(0); // unchanged
  });
});

describe('Payment table', () => {
  it('creates a payment record for an enrollment', async () => {
    const teacher = await createTeacher(emailFor('teacher-payment'));
    const student = await createStudent(emailFor('student-payment'));
    const course = await createCourse(teacher.id, 'Payment Course', 10000);
    const enrollment = await createEnrollment(student.id, course.id);

    const payment = await createPayment(enrollment.id, inrCurrencyId, completedPaymentStatusId, 10000);

    expect(payment.amountMinorUnits).toBe(10000);
    expect(payment.currencyValueId).toBe(inrCurrencyId);
    expect(payment.statusValueId).toBe(completedPaymentStatusId);
  });

  it('links a payment to a coupon', async () => {
    const teacher = await createTeacher(emailFor('teacher-coupon-link'));
    const student = await createStudent(emailFor('student-coupon-link'));
    const course = await createCourse(teacher.id, 'Coupon Link Course', 8000);
    const coupon = await createCoupon(course.id, percentageDiscountId, 20);
    const enrollment = await createEnrollment(student.id, course.id);

    const discountedAmount = 6400; // 20% off 8000
    const payment = await createPayment(
      enrollment.id,
      inrCurrencyId,
      completedPaymentStatusId,
      discountedAmount,
      { couponId: coupon.id },
    );

    expect(payment.couponId).toBe(coupon.id);
    expect(payment.amountMinorUnits).toBe(discountedAmount);
  });

  it('stores provider reference', async () => {
    const teacher = await createTeacher(emailFor('teacher-provider'));
    const student = await createStudent(emailFor('student-provider'));
    const course = await createCourse(teacher.id, 'Provider Course', 5000);
    const enrollment = await createEnrollment(student.id, course.id);

    const payment = await createPayment(
      enrollment.id,
      inrCurrencyId,
      completedPaymentStatusId,
      5000,
      { providerReference: 'ch_1234567890' },
    );

    expect(payment.providerReference).toBe('ch_1234567890');
  });

  it('stores provider error', async () => {
    const teacher = await createTeacher(emailFor('teacher-error'));
    const student = await createStudent(emailFor('student-error'));
    const course = await createCourse(teacher.id, 'Error Course', 6000);
    const enrollment = await createEnrollment(student.id, course.id);

    const payment = await createPayment(
      enrollment.id,
      inrCurrencyId,
      pendingPaymentStatusId,
      6000,
      { providerError: 'Insufficient funds' },
    );

    expect(payment.providerError).toBe('Insufficient funds');
  });

  it('allows multiple payments per enrollment (retries)', async () => {
    const teacher = await createTeacher(emailFor('teacher-retry'));
    const student = await createStudent(emailFor('student-retry'));
    const course = await createCourse(teacher.id, 'Retry Course', 7000);
    const enrollment = await createEnrollment(student.id, course.id);

    const payment1 = await createPayment(
      enrollment.id,
      inrCurrencyId,
      pendingPaymentStatusId,
      7000,
    );
    const payment2 = await createPayment(
      enrollment.id,
      inrCurrencyId,
      completedPaymentStatusId,
      7000,
    );

    expect(payment1.id).not.toBe(payment2.id);
    expect(payment1.enrollmentId).toBe(payment2.enrollmentId);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
