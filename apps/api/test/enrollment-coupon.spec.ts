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
 * A coupon's arithmetic, seen from the enrollment that redeems it.
 *
 * What this file owns is the discount itself — a code written straight onto the table, a percentage
 * taken off the course's own price, and the redemption count that says the code was spent. The
 * two-step contract around it (a place held behind a `pending` payment, the pay press that settles
 * it, a refusal that leaves the place shut) is `enrollment-payment.spec.ts`, and this file runs that
 * contract against a gateway that always says yes so the numbers below are the only variable.
 *
 * The port is named in the override rather than left to the ambient environment because the
 * deployment default is `none`, and a box that takes no money would answer 503 before any of these
 * assertions could be reached.
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
        teacherUserId: (
          await prisma.user.findFirstOrThrow({
            where: { email: teacherEmail },
          })
        ).id,
      },
    });

    // Create a 20% discount coupon
    const discountTypeValueId = await prisma.lkpValue
      .findFirstOrThrow({
        where: { type: { code: 'DiscountType' }, code: 'percentage' },
      })
      .then((v) => v.id);

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

    const studentUser = await prisma.user.findFirstOrThrow({
      where: { email: studentEmail },
    });

    const enrollmentId = enrollResponse.body.enrollment.id as string;

    // The discount is the number the place is held behind: 20% off $100 is $80, and the money has
    // not arrived yet, so the door is still shut.
    expect(enrollResponse.body.enrollment.isActive).toBe(false);
    expect(enrollResponse.body.payment).toMatchObject({
      amountMinorUnits: 8000,
      status: 'pending',
    });

    const payment = await prisma.payment.findFirst({
      where: { enrollment: { courseId: course.id, studentUserId: studentUser.id } },
      include: { coupon: true, status: true },
    });

    expect(payment?.amountMinorUnits).toBe(8000); // 20% off $100 = $80
    expect(payment?.coupon?.code).toBe('TEST20');
    expect(payment?.status.code).toBe('pending');

    // Verify coupon redemption count was incremented — the quote is filed, so the code is spent.
    const updatedCoupon = await prisma.coupon.findUnique({
      where: { id: coupon.id },
    });

    expect(updatedCoupon?.redemptionCount).toBe(1);

    // And the place opens on the pay press, on the same row rather than a second one.
    const paid = await request(app.getHttpServer())
      .post(`/api/v1/enrollments/${enrollmentId}/pay`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(paid.body.enrollment.isActive).toBe(true);
    expect(paid.body.payment).toMatchObject({ id: payment?.id, status: 'completed' });
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

  it('holds a priced course at its full amount when no coupon is offered', async () => {
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

    // A course with a price and no code on it is held at that price: the student is quoted the
    // shelf's own number, and the place opens when the money for it arrives.
    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ courseId: course.id })
      .expect(200);

    expect(response.body.enrollment).toBeDefined();
    expect(response.body.enrollment.isActive).toBe(false);
    expect(response.body.payment).toMatchObject({
      amountMinorUnits: 10000,
      status: 'pending',
    });

    const student = await prisma.user.findFirstOrThrow({ where: { email: studentEmail } });
    const rows = await prisma.payment.findMany({
      where: { enrollment: { courseId: course.id, studentUserId: student.id } },
      include: { coupon: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.couponId).toBeNull();
  });
});
