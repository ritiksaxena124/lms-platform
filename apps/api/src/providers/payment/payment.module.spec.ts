import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ENV, EnvModule } from '../../config/env.module';
import { MockPayment } from './mock-payment.adapter';
import { NoPayment } from './no-payment.adapter';
import { buildPayment, PaymentModule } from './payment.module';
import { PAYMENT, type PaymentProvider, UnchargeableAttemptError } from './payment.port';

/**
 * Which adapter the environment asks for, and what a box that takes no money answers.
 *
 * The port is only worth having if that choice is made in exactly one place. A service injected
 * with `PAYMENT` should not also have to know whether this deployment collects money at all, which
 * is the question `PAYMENT_PROVIDER` was added to the schema to answer and that nothing has read
 * since — until now the answer to "has the money arrived" was written into the row as a guess.
 */
describe('payment provider selection', () => {
  it('builds the mock gateway for the provider the environment names', () => {
    expect(buildPayment({ PAYMENT_PROVIDER: 'mock' })).toBeInstanceOf(MockPayment);
  });

  it('builds a port that takes no money where payments are not wired up', async () => {
    const payment = buildPayment({ PAYMENT_PROVIDER: 'none' });

    expect(payment).toBeInstanceOf(NoPayment);
    // The question a caller actually asks, and the one it asks before it writes anything. `none`
    // being an implementation rather than an `if` in the enrollment route is what keeps that route
    // from inventing a charge for a box that has no way to collect one.
    expect(payment.takesMoney).toBe(false);
    await expect(
      payment.collect({ id: 'a', amountMinorUnits: 500, currency: 'USD' }),
    ).rejects.toThrow(UnchargeableAttemptError);
  });

  it('refuses a provider it has no adapter for, rather than quietly running without money', () => {
    // The silent direction is the dangerous one: a student told their place is opening, and a
    // ledger row that says `completed` for money nobody ever asked for.
    expect(() => buildPayment({ PAYMENT_PROVIDER: 'stripe' } as never)).toThrow(/stripe/i);
  });

  it('hands the port to anything that asks for it by token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, PaymentModule],
    })
      // Named here rather than inherited from the ambient environment, so the spec says what it
      // proves no matter what a developer's own .env has decided about payments.
      .overrideProvider(ENV)
      .useValue({ PAYMENT_PROVIDER: 'mock' })
      .compile();

    expect(moduleRef.get<PaymentProvider>(PAYMENT)).toBeInstanceOf(MockPayment);
  });
});
