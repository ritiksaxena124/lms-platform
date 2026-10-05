import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { MockPayment } from '../src/providers/payment/mock-payment.adapter';
import { PAYMENT } from '../src/providers/payment/payment.port';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A coupon from the teacher's own side of the counter.
 *
 * The code here is created through `POST /courses/:id/coupons` rather than written onto the table,
 * which is what makes this file the place the teacher's numbers are proved: a percentage, a
 * redemption limit, and a validity window that closed yesterday. What the enrollment does with a
 * coupon that passes those checks — and what the pay button then does with the place it holds — is
 * `enrollment-payment.spec.ts`; the port is overridden with the gateway that always says yes so that
 * only the coupon's own arithmetic is in question.
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
  app = await createTestApp({ imports: [AppModule] }, [[PAYMENT, new MockPayment()]]);
  await app.listen(0);
  await seedLookups(prisma);
});

afterAll(async () => {
  // Cleanup - delete in reverse foreign key order
  await prisma.payment.deleteMany({
    where: { enrollment: { course: { slug: { startsWith: `coupon-e2e-${RUN}` } } } },
  });
  await prisma.enrollment.deleteMany({
    where: { course: { slug: { startsWith: `coupon-e2e-${RUN}` } } },
  });
  await prisma.coupon.deleteMany({
    where: { course: { slug: { startsWith: `coupon-e2e-${RUN}` } } },
  });
  await prisma.course.deleteMany({
    where: { slug: { startsWith: `coupon-e2e-${RUN}` } },
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

describe('Enrollment with coupon - E2E', () => {
  it('creates a coupon, quotes its discount against the place, and settles it on the pay press', async () => {
    // Create teacher and student
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'E2E Teacher',
        email: emailFor('e2e-teacher'),
        password: PASSWORD,
        role: 'teacher',
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'E2E Student',
        email: emailFor('e2e-student'),
        password: PASSWORD,
        role: 'student',
      });

    const teacherToken = await tokenFor('e2e-teacher');
    const studentToken = await tokenFor('e2e-student');

    // Get lookup IDs
    const levelValueId = await prisma.lkpValue
      .findFirstOrThrow({
        where: { type: { code: 'CourseLevel' }, code: 'beginner' },
      })
      .then((v) => v.id);

    const statusValueId = await prisma.lkpValue
      .findFirstOrThrow({
        where: { type: { code: 'CourseStatus' }, code: 'published' },
      })
      .then((v) => v.id);

    const currencyValueId = await prisma.lkpValue
      .findFirstOrThrow({
        where: { type: { code: 'Currency' } },
      })
      .then((v) => v.id);

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
        priceCurrencyValueId: currencyValueId,
        teacherUserId: teacher.id,
      },
    });

    // Teacher creates a 25% discount coupon
    const discountTypeValueId = await prisma.lkpValue
      .findFirstOrThrow({
        where: { type: { code: 'DiscountType' }, code: 'percentage' },
      })
      .then((v) => v.id);

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

    const couponId = createCouponResponse.body.coupon.id;
    expect(createCouponResponse.body.coupon.code).toBe('TEST25');
    expect(createCouponResponse.body.coupon.discountAmount).toBe(25);

    // Student enrolls with the coupon
    const enrollResponse = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id, couponCode: 'TEST25' })
      .expect(200);

    expect(enrollResponse.body.enrollment).toBeDefined();
    expect(enrollResponse.body.enrollment.course.id).toBe(course.id);

    // The discount is the quote the place is held behind: 25% off $100 is $75, and the money has
    // not arrived, so the student is not in the course yet.
    expect(enrollResponse.body.enrollment.isActive).toBe(false);
    expect(enrollResponse.body.payment).toMatchObject({
      amountMinorUnits: 7500,
      status: 'pending',
    });

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
      include: { coupon: true, status: true },
    });

    expect(payment?.amountMinorUnits).toBe(7500); // 25% off $100 = $75
    expect(payment?.coupon?.id).toBe(couponId);
    expect(payment?.status.code).toBe('pending');

    // Verify coupon redemption count was incremented
    const updatedCoupon = await prisma.coupon.findUnique({
      where: { id: couponId },
    });

    expect(updatedCoupon?.redemptionCount).toBe(1);

    // The pay press asks the gateway for the quoted amount and opens the place on the answer, on
    // the row the quote wrote rather than a second one.
    const paid = await request(app.getHttpServer())
      .post(`/api/v1/enrollments/${enrollResponse.body.enrollment.id}/pay`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(paid.body.enrollment.isActive).toBe(true);
    expect(paid.body.payment).toMatchObject({ status: 'completed', amountMinorUnits: 7500 });

    const rows = await prisma.payment.findMany({
      where: { enrollmentId: enrollResponse.body.enrollment.id },
    });
    expect(rows).toHaveLength(1);

    const afterPaying = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    expect(afterPaying.redemptionCount).toBe(1);
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
    const discountTypeValueId = await prisma.lkpValue
      .findFirstOrThrow({
        where: { type: { code: 'DiscountType' }, code: 'percentage' },
      })
      .then((v) => v.id);

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

  it('holds the full price on a place taken without a coupon', async () => {
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

    // A place with no code on it still has a price, and the price is what the ledger is asked for:
    // one pending row for the full amount, with no coupon behind it. Before the gate existed this
    // press wrote no row at all, which left a priced course opening for nothing.
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
      include: { status: true },
    });

    expect(payments).toHaveLength(1);
    expect(payments[0]?.amountMinorUnits).toBe(10000);
    expect(payments[0]?.couponId).toBeNull();
    expect(payments[0]?.status.code).toBe('pending');
  });
});
