import { Module } from '@nestjs/common';

import type { AppEnv } from '../../config/env';
import { ENV } from '../../config/env.module';
import { MockPayment } from './mock-payment.adapter';
import { NoPayment } from './no-payment.adapter';
import { PAYMENT, type PaymentProvider, UnknownPaymentProviderError } from './payment.port';

/** The part of the environment this choice needs — spelled out so a spec can name a provider
 * without inventing a whole config. */
export type PaymentEnv = Pick<AppEnv, 'PAYMENT_PROVIDER'>;

/**
 * The one place a provider string becomes an object.
 *
 * Both answers are complete. `mock` is what this POC runs on: the charge succeeds, the ledger keeps
 * a reference nobody outside this process minted, and every screen above it is the screen a real
 * gateway would drive. `none` is what a deployment that does not collect runs, and it is a first-class
 * value rather than a TODO — money that cannot arrive is a fact the student is told, not a row that
 * says `completed` because nothing was there to say otherwise.
 *
 * Anything else stops at boot rather than choosing for the operator. Defaulting an unknown provider
 * to `mock` would silently hand a school an enrollment machine that reports it has been paid.
 */
export function buildPayment(env: PaymentEnv): PaymentProvider {
  if (env.PAYMENT_PROVIDER === 'mock') return new MockPayment();
  if (env.PAYMENT_PROVIDER === 'none') return new NoPayment();

  throw new UnknownPaymentProviderError(env.PAYMENT_PROVIDER);
}

@Module({
  providers: [
    {
      provide: PAYMENT,
      useFactory: (env: AppEnv) => buildPayment(env),
      inject: [ENV],
    },
  ],
  exports: [PAYMENT],
})
export class PaymentModule {}
