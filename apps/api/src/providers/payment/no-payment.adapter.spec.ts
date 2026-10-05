import { describe, expect, it } from 'vitest';

import { UnchargeableAttemptError } from './payment.port';
import { NoPayment } from './no-payment.adapter';

/**
 * The provider a deployment runs on when it has not decided to take money.
 *
 * The whole of what this adapter does is refuse, and it refuses in two registers. `takesMoney` is
 * the answer the enrollment service reads *before* it writes anything, which is why the shape is a
 * question and not an exception: `PAYMENT_PROVIDER=none` is a configuration people run — a school
 * that quotes a price and collects it elsewhere — and a student on that box has to be told the
 * platform cannot take their payment rather than left holding a place that waits on money that will
 * never arrive.
 *
 * `collect` throwing is the second half of the same rule. An adapter that answered it is one the
 * caller never asked the first question, and a `completed` for money nobody was asked for is a
 * ledger row somebody has to explain years later.
 */
describe('NoPayment', () => {
  it('says it takes no money', () => {
    expect(new NoPayment().takesMoney).toBe(false);
  });

  it('refuses to charge anything when asked anyway', async () => {
    const payment = new NoPayment();

    await expect(
      payment.collect({ id: 'a', amountMinorUnits: 100, currency: 'INR' }),
    ).rejects.toThrow(UnchargeableAttemptError);
  });
});
