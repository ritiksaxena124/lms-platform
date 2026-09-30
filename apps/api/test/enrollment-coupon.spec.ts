import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Enrollment with coupon: a student takes a place using a discount code.
 *
 * This verifies that when a coupon is provided:
 * 1. The course price is reduced correctly
 * 2. A payment record is created linking enrollment to coupon
 * 3. The coupon's redemption count is incremented
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
  // Cleanup - delete in reverse foreign key order
  await prisma.payment.deleteMany({
    where: { enrollment: { course: { slug: { startsWith: `coupon-test-${RUN}` } } } },
  });
  await prisma.enrollment.deleteMany({
    where: { course: { slug: { startsWith: `coupon-test-${RUN}` } } },
  });
  await prisma.coupon.deleteMany({
    where: { course: { slug: { startsWith: `coupon-test-${RUN}` } } },
  });
  await prisma.course.deleteMany({
    where: { slug: { startsWith: `coupon-test-${RUN}` } },
  });
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { endsWith: `.${RUN}@localtest.me` } } },
  });
  await prisma.mailOutbox.deleteMany({
    where: { recipient: { email: { endsWith: `.${RUN}@localtest.me` } } },
  });
  await prisma.actionLog.deleteMany({
    where: { actor: { email: { endsWith: `.${RUN}@localtest.me` } } },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `.${RUN}@localtest.me` } },
  });

  await app.close();
  await prisma.$disconnect();
});

describe('Enrollment with coupon', () => {
  it('enrolls with a percentage discount coupon and creates a payment', async () => {
    // Create teacher and student accounts
    const teacherEmail = emailFor('coupon-teacher');
    const studentEmail = emailFor('coupon-student');

    // Register teacher
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Coupon Teacher',
      email: teacherEmail,
      password: PASSWORD,
      role: 'teacher',
    });

    // Register student
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Coupon Student',
      email: studentEmail,
      password: PASSWORD,
      role: 'student',
    });

    const teacherToken = await tokenFor('coupon-teacher');
    const studentToken = await tokenFor('coupon-student');

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

    // Create a published course with price $100
    const course = await prisma.course.create({
      data: {
        slug: `coupon-test-${RUN}`,
        title: 'Coupon Test Course',
        summary: 'A course for testing coupons',
        description: 'Testing coupon integration',
        levelValueId,
        statusValueId,
        priceMinorUnits: 10000, // $100.00
        priceCurrencyValueId: currencyValueId,
        teacherUserId: (await prisma.user.findFirstOrThrow({
          where: { email: teacherEmail },
        })).id,
      },
    });

    // Create a 20% discount coupon
    const discountTypeValueId = await prisma.lkpValue.findFirstOrThrow({
      where: { type: { code: 'DiscountType' }, code: 'percentage' },
    }).then((v) => v.id);

    const coupon = await prisma.coupon.create({
      data: {
        courseId: course.id,
        code: 'TEST20',
        discountTypeValueId,
        discountAmount: 20,
        isActive: true,
      },
    });

    // Enroll with coupon
    const enrollResponse = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id, couponCode: coupon.code })
      .expect(200);

    expect(enrollResponse.body.enrollment).toBeDefined();
    expect(enrollResponse.body.enrollment.course.id).toBe(course.id);

    // Verify payment was created with correct discounted amount (20% off $100 = $80)
    const studentUser = await prisma.user.findFirstOrThrow({
      where: { email: studentEmail },
    });

    const payment = await prisma.payment.findFirst({
      where: { enrollment: { courseId: course.id, studentUserId: studentUser.id } },
      include: { coupon: true },
    });

    expect(payment).toBeDefined();
    expect(payment?.amountMinorUnits).toBe(8000); // 20% off $100 = $80
    expect(payment?.coupon?.code).toBe('TEST20');

    // Verify coupon redemption count was incremented
    const updatedCoupon = await prisma.coupon.findUnique({
      where: { id: coupon.id },
    });

    expect(updatedCoupon?.redemptionCount).toBe(1);
  });

  it('rejects an invalid coupon code', async () => {
    const studentEmail = emailFor('invalid-coupon-student');

    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'Invalid Coupon Student',
      email: studentEmail,
      password: PASSWORD,
      role: 'student',
    });

    const studentToken = await tokenFor('invalid-coupon-student');

    // Get any published course
    const course = await prisma.course.findFirst({
      where: { slug: { startsWith: `coupon-test-${RUN}` } },
    });

    if (!course) throw new Error('No test course found');

    // Try to enroll with invalid coupon
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id, couponCode: 'INVALID' })
      .expect(400);

    expect(response.body.message).toContain('Coupon not found');
  });

  it('allows enrollment without a coupon', async () => {
    const studentEmail = emailFor('no-coupon-student');

    await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      fullName: 'No Coupon Student',
      email: studentEmail,
      password: PASSWORD,
      role: 'student',
    });

    const studentToken = await tokenFor('no-coupon-student');

    // Get any published course
    const course = await prisma.course.findFirst({
      where: { slug: { startsWith: `coupon-test-${RUN}` } },
    });

    if (!course) throw new Error('No test course found');

    // Enroll without coupon
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id })
      .expect(200);

    expect(response.body.enrollment).toBeDefined();
  });
});
