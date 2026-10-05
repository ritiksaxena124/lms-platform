/**
 * Money that has to arrive for a place to open, stated without naming a vendor SDK
 * (ARCHITECTURE §6, §14).
 *
 * The enrollment row answers *who holds a place*; this port answers *whether the money for it came*.
 * Those are two questions with two lifetimes — a place is kept, a charge is attempted — which is why
 * the `payment` table is an append-only ledger beside the enrollment rather than four more columns
 * on it, and why the answer to "has it arrived" has to come from something that can actually be
 * asked rather than be written down as a guess.
 *
 * Three rules this port inherits from the ones beside it.
 *
 * **The caller mints the attempt id.** A `payment` row exists before anyone asks a provider about
 * it, so the ledger's own primary key is the thing a gateway is told to charge against — the same
 * division the storage port uses for its key and the video port uses for a room name. Nothing here
 * builds an identifier out of a course id, an amount or a timestamp: a caller that did would be
 * letting the provider decide what distinguishes one press from the next.
 *
 * **An outcome is not a permission.** This port answers "did the money arrive for this attempt",
 * never "may this student have the place". The gate is the enrollment service, and it is the half
 * that decides whether to open a row, file news about it, or leave it closed and say so.
 *
 * **The amount and currency travel together and are never recomputed here.** A quote is what the
 * student was shown; a charge is what the gateway takes. The service writes the quote into the
 * ledger row and hands that row's own numbers to the provider, so a retry collects what the first
 * attempt asked for even if the course's price moved in between.
 */
export const PAYMENT = Symbol('PAYMENT');

/** What this platform is asking to be paid: a ledger row that already exists, and the two numbers
 * written on it. */
export interface PaymentAttempt {
  /** The `payment` row's own id — minted by the write, presented to the provider. */
  id: string;
  /** Minor units, the way `packages/shared` moves money. Always positive: a place that costs
   * nothing is not sent to a gateway, it is simply opened. */
  amountMinorUnits: number;
  /** ISO 4217, read from the currency row the course's own price was written against. */
  currency: string;
}

/** What came back. Two shapes rather than one object with optional halves, because "the money
 * arrived" and "the money did not arrive, and here is why" are never both true, and a caller that
 * has to check a second field to find out which it got will eventually forget to. */
export type PaymentOutcome =
  { status: 'completed'; providerReference: string } | { status: 'failed'; error: string };

export interface PaymentProvider {
  /**
   * Whether this box can ask anybody for money at all.
   *
   * A question the port answers so the caller does not have to know which adapter it was given: a
   * deployment with `PAYMENT_PROVIDER=none` cannot settle anything, and the enrollment service has to
   * find that out *before* it writes a place waiting on money that will never arrive. Asking
   * `collect` instead would be the wrong instrument — a charge that is never going to happen should
   * not be presented to a gateway as an attempt.
   */
  readonly takesMoney: boolean;

  /**
   * Ask for the money, and report what happened.
   *
   * A promise rather than an answer, because a charge is a conversation with something outside this
   * process even when the thing outside is a mock that resolves immediately; the video port stayed
   * synchronous because a Jitsi room needs no handshake, and a payment always needs one.
   *
   * A refused charge is a returned `failed`, not a throw: a declined card is an answer, and the
   * caller's job is to record it on the ledger and leave the place closed. A throw is reserved for
   * a caller that asked for something that is not money at all — see `UnchargeableAttemptError` —
   * or that asked a provider which has said it takes nothing.
   */
  collect(attempt: PaymentAttempt): Promise<PaymentOutcome>;
}

/** An attempt that could not be charged: no amount, a negative one, a fraction of a minor unit, no
 * currency to name it in, or a provider that has already said it takes nothing. Thrown, not
 * returned — a caller that reaches a gateway with a zero has already decided that a free place costs
 * something, and recording `completed` for money nobody was asked for is the kind of ledger row
 * somebody has to explain years later. */
export class UnchargeableAttemptError extends Error {
  constructor(reason: string) {
    super(`Payment attempt is not chargeable: ${reason}`);
    this.name = 'UnchargeableAttemptError';
  }
}

/** Judged when the provider is built, which is at boot: a deployment should find out that its
 * payment config names a gateway nothing implements before a student is standing on a pay button
 * waiting for an answer. */
export class UnknownPaymentProviderError extends Error {
  constructor(provider: string) {
    super(
      `Payment provider "${provider}" has no adapter; set PAYMENT_PROVIDER=mock or PAYMENT_PROVIDER=none`,
    );
    this.name = 'UnknownPaymentProviderError';
  }
}
