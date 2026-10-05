import {
  UnchargeableAttemptError,
  type PaymentAttempt,
  type PaymentOutcome,
  type PaymentProvider,
} from './payment.port';

/**
 * The provider a deployment runs when it takes no money (ARCHITECTURE §6).
 *
 * `PAYMENT_PROVIDER=none` is a real configuration, not a placeholder: a school that quotes a price
 * and collects it on an invoice has no reason to point this platform at a gateway. What it must not
 * have is a place that quietly opened anyway, which is why `takesMoney` is the false the enrollment
 * service reads before it writes anything — the student is told this box cannot take the payment
 * rather than being enrolled on a promise.
 *
 * `collect` throws for the same reason it refuses to answer `completed`: a caller that reached this
 * adapter has skipped the question above, and a silent answer either way would be a ledger row
 * nobody can explain later.
 */
export class NoPayment implements PaymentProvider {
  readonly takesMoney = false;

  async collect(_attempt: PaymentAttempt): Promise<PaymentOutcome> {
    throw new UnchargeableAttemptError(
      'this deployment has no payment provider, so nothing can be collected',
    );
  }
}
