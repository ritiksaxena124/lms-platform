import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_EVENT_CODES } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { MockPayment } from '../src/providers/payment/mock-payment.adapter';
import { NoPayment } from '../src/providers/payment/no-payment.adapter';
import {
  PAYMENT,
  type PaymentAttempt,
  type PaymentOutcome,
  type PaymentProvider,
} from '../src/providers/payment/payment.port';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Money that has to arrive before a place opens.
 *
 * Before this file, a place was written and a `payment` row was written beside it reading
 * `completed` with the reference `mock-payment` — a ledger that said money had moved on a box that
 * had never asked anybody for any, and only when a coupon happened to be in the body. These tests
 * are the correction: the course's price is read on every path, the charge goes through a port, and
 * the place opens on the answer rather than on the hope.
 *
 * Four things are asserted on every road, because each is a different way for this to be a lie:
 *
 * - the **place** — `isActive` is the door every read behind it checks, so a pending payment must
 *   not have opened it, and a completed one must have;
 * - the **ledger** — one attempt is one row, a retry is a second row quoting the same amount, and
 *   nothing presses twice writes nothing twice;
 * - the **news** — a letter saying "you are in the course" is filed when the student is in the
 *   course, which on a priced course is not the moment they asked;
 * - the **money's own name** — the currency is the one the teacher priced the course in, not the
 *   first currency row in the database, which is the difference between a quote and a guess.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
/** The coupon endpoint files a code upper-case, and the lookup is exact — so a test that writes a
 * lower-case hex run into a code has to read it back the same way the shelf stores it. */
const codeFor = (prefix: string) => `${prefix}${RUN}`.toUpperCase();

/** The port as a test can hold it: it behaves like the gateway this POC ships, until a test says
 * otherwise. `answer = undefined` means "say what the mock would say"; a `failed` outcome means
 * "the charge was refused"; and `takesMoney = false` is the other adapter — the one a deployment
 * runs when it collects elsewhere — which the service has to hear *before* it writes anything. */
class FakeGateway implements PaymentProvider {
  answer: PaymentOutcome | undefined = undefined;
  takesMoney = true;

  collect(attempt: PaymentAttempt): Promise<PaymentOutcome> {
    if (this.answer !== undefined) return Promise.resolve(this.answer);
    if (!this.takesMoney) return new NoPayment().collect(attempt);
    return new MockPayment().collect(attempt);
  }
}

const gateway = new FakeGateway();

let app: INestApplication;
const prisma = new PrismaClient();
let teacher: string;
let student: string;
let stranger: string;
let studentId: string;

async function register(name: string, role: string): Promise<string> {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

let courseSequence = 0;

/** A published course, priced or not, with a coupon attached when the test asks for one. */
async function course(
  options: {
    price?: { minorUnits: number; currency: string } | null;
    coupon?: { code: string; type: string; amount: number };
  } = {},
): Promise<{ id: string; title: string }> {
  courseSequence += 1;
  const title = `Payment gate ${courseSequence} ${RUN}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title,
      slug: `pay-gate-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'An hour of talking.',
      description: 'Talk about films, food and travel, with corrections as we go.',
      ...(options.price ? { price: options.price } : {}),
    })
    .expect(201);

  const id = res.body.course.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${teacher}`)
    .expect(200);

  if (options.coupon) {
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${id}/coupons`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({
        code: options.coupon.code,
        discountType: options.coupon.type,
        discountAmount: options.coupon.amount,
      })
      .expect(201);
  }

  return { id, title };
}

async function enroll(
  courseId: string,
  body: Record<string, unknown> = {},
  token = student,
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${token}`)
    .send({ courseId, ...body });
  // Every caller of this helper expects the press to have worked; the envelope is the only thing
  // that says why it did not.
  if (res.status !== 200) throw new Error(`enroll ${res.status}: ${res.text}`);
  return { status: res.status, body: res.body };
}

async function pay(enrollmentId: string, token = student) {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/enrollments/${enrollmentId}/pay`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body as { enrollment: Record<string, any>; payment: Record<string, any> | null };
}

/** The letters one course filed for one reader. A pending place has to have filed none, so the
 * course title is the discriminator — a queued row names no enrollment. */
async function lettersFor(event: string, recipientId: string, courseTitle: string) {
  const rows = await prisma.mailOutbox.findMany({
    where: { eventCode: event, recipientUserId: recipientId },
  });
  return rows.filter(
    (row) => (row.payload as { slots: Record<string, string> }).slots.course_title === courseTitle,
  );
}

async function ledger(enrollmentId: string) {
  return prisma.payment.findMany({
    where: { enrollmentId },
    include: { status: true, currency: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function place(enrollmentId: string) {
  return prisma.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { id: true, isActive: true },
  });
}

beforeAll(async () => {
  await seedLookups(prisma);
  app = await createTestApp({ imports: [AppModule] }, [[PAYMENT, gateway]]);

  teacher = await register('payt', 'teacher');
  student = await register('pays', 'student');
  stranger = await register('payx', 'student');
  studentId = (await prisma.user.findFirstOrThrow({ where: { email: emailFor('pays') } })).id;
});

afterEach(() => {
  gateway.answer = undefined;
  gateway.takesMoney = true;
});

afterAll(async () => {
  await app?.close();
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);

  await prisma.payment.deleteMany({
    where: { enrollment: { course: { slug: { contains: `-${RUN}` } } } },
  });
  await prisma.coupon.deleteMany({ where: { course: { slug: { contains: `-${RUN}` } } } });
  await prisma.enrollment.deleteMany({ where: { course: { slug: { contains: `-${RUN}` } } } });
  await prisma.course.deleteMany({ where: { slug: { contains: `-${RUN}` } } });
  await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('a course with nothing to pay', () => {
  it('opens the place on the press and files no payment', async () => {
    const { id, title } = await course();

    const { status, body } = await enroll(id);

    expect(status).toBe(200);
    expect(body.enrollment.isActive).toBe(true);
    expect(body.payment).toBeNull();

    const rows = await ledger(body.enrollment.id);
    expect(rows).toHaveLength(0);
    await expect(
      lettersFor(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title),
    ).resolves.toHaveLength(1);
  });

  it('says so when somebody tries to pay for a place that never owed anything', async () => {
    const { id } = await course();
    const { body } = await enroll(id);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/enrollments/${body.enrollment.id}/pay`)
      .set('Authorization', `Bearer ${student}`)
      .expect(400);

    expect(res.body.code).toBe('BAD_REQUEST');
  });
});

describe('a course that costs money', () => {
  it('holds the place shut until the money arrives', async () => {
    const { id, title } = await course({ price: { minorUnits: 5000, currency: 'INR' } });

    const { status, body } = await enroll(id);

    expect(status).toBe(200);
    expect(body.enrollment.isActive).toBe(false);
    expect(body.payment).toMatchObject({
      amountMinorUnits: 5000,
      currency: 'INR',
      status: 'pending',
      providerReference: null,
      error: null,
    });

    // Nothing has been told to anybody about a place that does not exist yet.
    await expect(
      lettersFor(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title),
    ).resolves.toHaveLength(0);
    const recorded = await prisma.actionLog.findMany({
      where: {
        actorUserId: studentId,
        actionCode: 'enrollment_joined',
        targetId: body.enrollment.id,
      },
    });
    expect(recorded).toHaveLength(0);
  });

  it('opens the place when the charge completes, and files the news then', async () => {
    const { id, title } = await course({ price: { minorUnits: 5000, currency: 'INR' } });
    const { body } = await enroll(id);
    const attemptId = body.payment.id as string;

    const settled = await pay(body.enrollment.id);

    expect(settled.enrollment.isActive).toBe(true);
    expect(settled.payment).toMatchObject({
      id: attemptId,
      amountMinorUnits: 5000,
      currency: 'INR',
      status: 'completed',
      providerReference: `mock-${attemptId}`,
    });
    await expect(place(body.enrollment.id)).resolves.toMatchObject({ isActive: true });
    await expect(
      lettersFor(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title),
    ).resolves.toHaveLength(1);
  });

  it('keeps the currency the teacher priced the course in, whatever else is in the table', async () => {
    const { id } = await course({ price: { minorUnits: 1999, currency: 'USD' } });
    const { body } = await enroll(id);

    expect(body.payment.currency).toBe('USD');
    const usd = await prisma.lkpValue.findFirstOrThrow({
      where: { type: { code: 'Currency' }, code: 'USD' },
    });
    const [row] = await ledger(body.enrollment.id);
    expect(row?.currencyValueId).toBe(usd.id);
  });

  it('answers the same waiting attempt to a second press, instead of quoting twice', async () => {
    const { id } = await course({ price: { minorUnits: 5000, currency: 'INR' } });

    const first = await enroll(id);
    const second = await enroll(id);

    expect(second.status).toBe(200);
    expect(second.body.enrollment.id).toBe(first.body.enrollment.id);
    expect(second.body.payment.id).toBe(first.body.payment.id);
    await expect(ledger(first.body.enrollment.id)).resolves.toHaveLength(1);
  });

  it('settles one attempt when the pay button is pressed twice', async () => {
    const { id, title } = await course({ price: { minorUnits: 5000, currency: 'INR' } });
    const { body } = await enroll(id);

    await pay(body.enrollment.id);
    const replay = await pay(body.enrollment.id);

    expect(replay.enrollment.isActive).toBe(true);
    expect(replay.payment?.status).toBe('completed');
    await expect(ledger(body.enrollment.id)).resolves.toHaveLength(1);
    await expect(
      lettersFor(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title),
    ).resolves.toHaveLength(1);
  });

  it('leaves the place shut when the charge is refused, and asks again for the same amount', async () => {
    const { id, title } = await course({ price: { minorUnits: 5000, currency: 'INR' } });
    const { body } = await enroll(id);
    gateway.answer = { status: 'failed', error: 'The card was declined.' };

    const refused = await pay(body.enrollment.id);

    expect(refused.enrollment.isActive).toBe(false);
    expect(refused.payment).toMatchObject({ status: 'failed', error: 'The card was declined.' });
    await expect(
      lettersFor(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title),
    ).resolves.toHaveLength(0);

    // A retry is a new attempt, not a rewrite of the one that was refused: the ledger keeps both.
    gateway.answer = undefined;
    const retried = await pay(body.enrollment.id);

    expect(retried.enrollment.isActive).toBe(true);
    expect(retried.payment).toMatchObject({ amountMinorUnits: 5000, status: 'completed' });
    const rows = await ledger(body.enrollment.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.amountMinorUnits).toBe(5000);
    expect(rows[1]?.amountMinorUnits).toBe(5000);
  });

  it('refuses to open a place it has no way to charge for', async () => {
    const { id } = await course({ price: { minorUnits: 5000, currency: 'INR' } });
    gateway.takesMoney = false;

    const res = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${student}`)
      .send({ courseId: id })
      .expect(503);

    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    // Refused before anything was written: no place waiting on money that can never arrive.
    const rows = await prisma.enrollment.findMany({
      where: { courseId: id, studentUserId: studentId },
    });
    expect(rows).toHaveLength(0);
  });

  it("will not pay for a place that is not the caller's", async () => {
    const { id } = await course({ price: { minorUnits: 5000, currency: 'INR' } });
    const { body } = await enroll(id);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/enrollments/${body.enrollment.id}/pay`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
    await expect(place(body.enrollment.id)).resolves.toMatchObject({ isActive: false });
  });
});

describe('a coupon against a priced course', () => {
  it('quotes the discounted amount and still waits for the money', async () => {
    const { id } = await course({
      price: { minorUnits: 10000, currency: 'INR' },
      coupon: { code: codeFor('CUT20'), type: 'percentage', amount: 20 },
    });

    const { body } = await enroll(id, { couponCode: codeFor('CUT20') });

    expect(body.payment).toMatchObject({
      amountMinorUnits: 8000,
      status: 'pending',
      currency: 'INR',
    });

    const settled = await pay(body.enrollment.id);
    expect(settled.payment).toMatchObject({ amountMinorUnits: 8000, status: 'completed' });
    expect(settled.enrollment.isActive).toBe(true);

    const coupon = await prisma.coupon.findFirstOrThrow({ where: { courseId: id } });
    expect(coupon.redemptionCount).toBe(1);
  });

  it('settles a place a coupon brought to nothing without asking a gateway', async () => {
    const { id, title } = await course({
      price: { minorUnits: 10000, currency: 'INR' },
      coupon: { code: codeFor('FREE'), type: 'percentage', amount: 100 },
    });

    const { body } = await enroll(id, { couponCode: codeFor('FREE') });

    expect(body.enrollment.isActive).toBe(true);
    expect(body.payment).toMatchObject({
      amountMinorUnits: 0,
      status: 'completed',
      providerReference: null,
    });
    await expect(
      lettersFor(MAIL_EVENT_CODES.ENROLLMENT_JOINED, studentId, title),
    ).resolves.toHaveLength(1);

    const coupon = await prisma.coupon.findFirstOrThrow({ where: { courseId: id } });
    expect(coupon.redemptionCount).toBe(1);
  });

  it('counts one redemption for a place that was asked for twice', async () => {
    const { id } = await course({
      price: { minorUnits: 10000, currency: 'INR' },
      coupon: { code: codeFor('TWICE'), type: 'fixed', amount: 2000 },
    });

    const first = await enroll(id, { couponCode: codeFor('TWICE') });
    const second = await enroll(id, { couponCode: codeFor('TWICE') });

    expect(second.body.payment.id).toBe(first.body.payment.id);

    const coupon = await prisma.coupon.findFirstOrThrow({ where: { courseId: id } });
    expect(coupon.redemptionCount).toBe(1);
  });

  it('redeems nothing for a coupon the course does not recognise', async () => {
    const { id } = await course({ price: { minorUnits: 10000, currency: 'INR' } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${student}`)
      .send({ courseId: id, couponCode: 'NOPE' })
      .expect(400);

    expect(res.body.code).toBe('BAD_REQUEST');
    const rows = await prisma.enrollment.findMany({
      where: { courseId: id, studentUserId: studentId },
    });
    expect(rows).toHaveLength(0);
  });
});
