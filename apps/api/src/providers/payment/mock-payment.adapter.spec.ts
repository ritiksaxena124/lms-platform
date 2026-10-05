import { describe, expect, it } from 'vitest';

import { MockPayment } from './mock-payment.adapter';
import type { PaymentAttempt } from './payment.port';

/** The attempt a caller would hand the port: a ledger row that already exists, priced in the
 * currency the course's own price was written in. */
const attempt = (over: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  id: 'b1a4c8e2-0000-4000-8000-000000000001',
  amountMinorUnits: 8000,
  currency: 'INR',
  ...over,
});

/**
 * The stand-in gateway this POC runs on.
 *
 * It is not a simulator of a payment provider's moods — there is no random refusal, no latency, no
 * card-decline table. It is the answer a gateway gives when the money arrives, produced without a
 * network and without a vendor, so every route above it can be walked end to end. What it owes the
 * reader of this file is that it never *pretends* to have taken money it was not asked for: the
 * reference it returns is derived from the attempt it was handed, so a retry of the same row is
 * recognisable and nobody can mistake one attempt for another.
 */
describe('MockPayment', () => {
  it('says it takes money, which is the whole reason a deployment points at it', () => {
    expect(new MockPayment().takesMoney).toBe(true);
  });

  it('says the money arrived, in the words the ledger understands', async () => {
    const payment = new MockPayment();

    await expect(payment.collect(attempt())).resolves.toEqual({
      status: 'completed',
      providerReference: 'mock-b1a4c8e2-0000-4000-8000-000000000001',
    });
  });

  it('answers the same attempt with the same reference, so a retry is not a second charge', async () => {
    const payment = new MockPayment();

    const first = await payment.collect(attempt());
    const second = await payment.collect(attempt());

    expect(second).toEqual(first);
  });

  it('names two different attempts apart', async () => {
    const payment = new MockPayment();

    const a = await payment.collect(attempt());
    const b = await payment.collect(attempt({ id: 'b1a4c8e2-0000-4000-8000-000000000002' }));

    expect(a).toEqual({
      status: 'completed',
      providerReference: 'mock-b1a4c8e2-0000-4000-8000-000000000001',
    });
    expect(b).toEqual({
      status: 'completed',
      providerReference: 'mock-b1a4c8e2-0000-4000-8000-000000000002',
    });
  });

  it('takes any currency it is quoted in, because choosing one is not this job', async () => {
    const payment = new MockPayment();

    // A gateway converts nothing and judges nothing here: the amount and the currency arrive written
    // on the ledger row, and the only thing this adapter decides is whether it was asked for money.
    await expect(
      payment.collect(attempt({ currency: 'USD', amountMinorUnits: 1999 })),
    ).resolves.toEqual({
      status: 'completed',
      providerReference: 'mock-b1a4c8e2-0000-4000-8000-000000000001',
    });
  });

  it('refuses an amount that is not money, because the caller has a bug', async () => {
    const payment = new MockPayment();

    // Zero is the sharpest of these: a free place never reaches a gateway, and a gateway that
    // "charged" nothing would leave a completed payment row on a place that cost nothing — the
    // ledger would say money moved when the course said it did not.
    await expect(payment.collect(attempt({ amountMinorUnits: 0 }))).rejects.toThrow(/amount/i);
    await expect(payment.collect(attempt({ amountMinorUnits: -100 }))).rejects.toThrow(/amount/i);
    await expect(payment.collect(attempt({ amountMinorUnits: 10.5 }))).rejects.toThrow(/amount/i);
  });

  it('refuses a currency that cannot be named, for the same reason', async () => {
    const payment = new MockPayment();

    await expect(payment.collect(attempt({ currency: '' }))).rejects.toThrow(/currency/i);
  });
});
