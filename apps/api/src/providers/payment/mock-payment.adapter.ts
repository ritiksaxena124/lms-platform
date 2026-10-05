import {
  UnchargeableAttemptError,
  type PaymentAttempt,
  type PaymentOutcome,
  type PaymentProvider,
} from './payment.port';

/**
 * The gateway this POC charges against: the answer a real one gives when the money arrives,
 * produced on the box that asked for it.
 *
 * It is deliberately not a simulator. No random refusal, no latency, no card table — a demo that
 * occasionally declined a payment would be a demo nobody can run twice, and the failure path is
 * exercised by tests that hand the enrollment service a provider which says `failed`. What this
 * adapter owns is the two things only a provider can supply: a reference, and the fact that the
 * attempt is over.
 *
 * The reference is derived from the attempt's own id rather than generated, so a retry of the same
 * row is recognisable as that row. This is not an idempotency key — a gateway would need one, and
 * when a vendor arrives, the number it mints replaces this string in one place and nowhere else.
 */
export class MockPayment implements PaymentProvider {
  readonly takesMoney = true;

  async collect(attempt: PaymentAttempt): Promise<PaymentOutcome> {
    if (!Number.isInteger(attempt.amountMinorUnits) || attempt.amountMinorUnits <= 0) {
      throw new UnchargeableAttemptError(
        `amount must be a positive whole number of minor units, got ${attempt.amountMinorUnits}`,
      );
    }
    if (!attempt.currency.trim()) {
      throw new UnchargeableAttemptError('currency is blank, so the amount names no money');
    }

    return { status: 'completed', providerReference: `mock-${attempt.id}` };
  }
}
