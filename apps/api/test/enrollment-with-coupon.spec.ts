import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Integration test: enrolling with a coupon code end-to-end.
 *
 * This verifies the complete flow:
 * 1. Teacher creates a coupon
 * 2. Student enrolls with the coupon code
 * 3. Payment is created with discounted amount
 * 4. Coupon redemption count is incremented
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();

async function tokenFor(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  app = await createTestApp({ imports: [AppModule] });
  await app.listen(0);
  await seedLookups(prisma);
});

afterAll(async () => {
  // Cleanup - use startsWith for UUID fields
  const studentUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@localtest.me` }, fullName: { contains: RUN } },
    select: { id: true },
  });
  
  const studentIds = studentUsers.map(u => u.id);
  
  if (studentIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { enrollment: { studentUserId: { in: studentIds } } },
    });
    await prisma.enrollment.deleteMany({
      where: { studentUserId: { in: studentIds } },
    });
  }
  
  await prisma.coupon.deleteMany({
    where: { code: { startsWith: 'TEST' } },
  });
  await prisma.course.deleteMany({
    where: { slug: { startsWith: `coupon-e2e-${RUN}` } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: studentIds } },
  });

  await app.close();
  await prisma.$disconnect();
});

describe('Enrollment with coupon - E2E', () => {
  it('creates coupon, enrolls with it, and verifies payment record', async () => {
    // Create teacher and student
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'E2E Teacher',
      email: emailFor('e2e-teacher'),
      password: PASSWORD,
      role: 'teacher',
    });

    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'E2E Student',
      email: emailFor('e2e-student'),
      password: PASSWORD,
      role: 'student',
    });

    const teacherToken = await tokenFor('e2e-teacher');
    const studentToken = await tokenFor('e2e-student');

    // Get lookup IDs
    const levelValueId = await prisma.lkpValue.findFirstOrThrow({
      where: { type: { code: 'CourseLevel' }, code: 'beginner' },
    }).then((v) => v.id);

    const statusValueId = await prisma.lkpValue.findFirstOrThrow({
      where: { type: { code: 'CourseStatus' }, code: 'published' },
    }).then((v) => v.id);

    const currencyValueId = await prisma.lkpValue.findFirstOrThrow({
      where: { type: { code: 'Currency' } },
    }).then((v) => v.id);

    const teacher = await prisma.user.findFirstOrThrow({
      where: { email: emailFor('e2e-teacher') },
    });

    // Create a published course with price $100
    const course = await prisma.course.create({
      data: {
        slug: `coupon-e2e-${RUN}`,
        title: 'E2E Coupon Test Course',
        summary: 'Testing coupon enrollment end-to-end',
        description: 'E2E testing',
        levelValueId,
        statusValueId,
        priceMinorUnits: 10000, // $100.00
        currencyValueId,
        teacherUserId: teacher.id,
      },
    });

    // Teacher creates a 25% discount coupon
    const discountTypeValueId = await prisma.lkpValue.findFirstOrThrow({
      where: { type: { code: 'DiscountType' }, code: 'percentage' },
    }).then((v) => v.id);

    const createCouponResponse = await request(app.getHttpServer())
      .post(`/api/v1/courses/${course.id}/coupons`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        code: 'TEST25',
        discountType: 'percentage',
        discountAmount: 25,
        validFrom: null,
        validUntil: null,
        maxRedemptions: 10,
      })
      .expect(201);

    const couponId = createCouponResponse.body.id;
    expect(createCouponResponse.body.code).toBe('TEST25');
    expect(createCouponResponse.body.discountAmount).toBe(25);

    // Student enrolls with the coupon
    const enrollResponse = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id, couponCode: 'TEST25' })
      .expect(200);

    expect(enrollResponse.body.enrollment).toBeDefined();
    expect(enrollResponse.body.enrollment.course.id).toBe(course.id);

    // Verify payment was created with correct discounted amount (25% off $100 = $75)
    const student = await prisma.user.findFirstOrThrow({
      where: { email: emailFor('e2e-student') },
    });

    const payment = await prisma.payment.findFirst({
      where: {
        enrollment: {
          courseId: course.id,
          studentUserId: student.id,
        },
      },
      include: { coupon: true },
    });

    expect(payment).toBeDefined();
    expect(payment?.amountMinorUnits).toBe(7500); // 25% off $100 = $75
    expect(payment?.coupon?.id).toBe(couponId);
    expect(payment?.statusValueId).toBeDefined();

    // Verify coupon redemption count was incremented
    const updatedCoupon = await prisma.coupon.findUnique({
      where: { id: couponId },
    });

    expect(updatedCoupon?.redemptionCount).toBe(1);
  });

  it('rejects enrollment with expired coupon', async () => {
    const studentEmail = emailFor('expired-coupon-student');

    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Expired Coupon Student',
      email: studentEmail,
      password: PASSWORD,
      role: 'student',
    });

    const studentToken = await tokenFor('expired-coupon-student');

    // Get the course
    const course = await prisma.course.findFirstOrThrow({
      where: { slug: { startsWith: `coupon-e2e-${RUN}` } },
    });

    // Create an expired coupon
    const discountTypeValueId = await prisma.lkpValue.findFirstOrThrow({
      where: { type: { code: 'DiscountType' }, code: 'percentage' },
    }).then((v) => v.id);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.coupon.create({
      data: {
        courseId: course.id,
        code: 'EXPIRED',
        discountTypeValueId,
        discountAmount: 20,
        validFrom: null,
        validUntil: yesterday.toISOString(),
        maxRedemptions: null,
        isActive: true,
      },
    });

    // Try to enroll with expired coupon
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id, couponCode: 'EXPIRED' })
      .expect(400);

    expect(response.body.message).toContain('expired');
  });

  it('allows enrollment without coupon code', async () => {
    const studentEmail = emailFor('no-coupon-student');

    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'No Coupon Student',
      email: studentEmail,
      password: PASSWORD,
      role: 'student',
    });

    const studentToken = await tokenFor('no-coupon-student');

    const course = await prisma.course.findFirstOrThrow({
      where: { slug: { startsWith: `coupon-e2e-${RUN}` } },
    });

    // Enroll without coupon
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id })
      .expect(200);

    expect(response.body.enrollment).toBeDefined();

    // Verify no payment was created (since no coupon was used)
    const student = await prisma.user.findFirstOrThrow({
      where: { email: studentEmail },
    });

    const payments = await prisma.payment.findMany({
      where: {
        enrollment: {
          courseId: course.id,
          studentUserId: student.id,
        },
      },
    });

    expect(payments.length).toBe(0);
  });
});
