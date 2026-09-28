/**
 * The states a queued notification passes through.
 *
 * This list is not a lookup type, and the reason is worth keeping: `Lkp*` exists so Ops can add a
 * value without a migration, and nobody can add a value here without writing the sweep code that
 * would honour it. A status whose only writer is a scheduler is a step in a program, not a piece of
 * reference data an operator maintains — so it sits next to the code that moves rows between these
 * states rather than in a table they could retire.
 *
 * Which states a row may move between is the delivery sweep's program (ARCHITECTURE §6, Phase 6e),
 * and how many times a row may be tried is the curve below it. Nothing in this list says what
 * happens next.
 */
export const MAIL_OUTBOX_STATUS_CODES = {
  /** Written by the transaction that made the news, and due the moment it exists. */
  QUEUED: 'queued',
  /** Somebody is talking to the transport about this row right now. A row can be left here by a
   * process that died mid-send, which is why the sweep has to be able to reclaim one rather than
   * assume the claim is honest. */
  SENDING: 'sending',
  /** The transport took it. `sentAt` is when, and nothing after this is expected. */
  SENT: 'sent',
  /** Out of attempts, with `failureReason` holding the transport's code from the last one. A row
   * that reached this state needs a person to notice it, which is Phase 8's screen rather than a
   * retry nobody asked for. */
  FAILED: 'failed',
  /** This box sends no mail (`delivers: false`), so the row was dropped rather than delivered.
   * Separate from `sent` on purpose: a notification that was thrown away and a notification that
   * was posted are two different answers to a person asking why they never heard. */
  DROPPED: 'dropped',
} as const;

export type MailOutboxStatusCode =
  (typeof MAIL_OUTBOX_STATUS_CODES)[keyof typeof MAIL_OUTBOX_STATUS_CODES];

/**
 * How long a row waits before each retry, in minutes, and the whole of the retry budget.
 *
 * A curve rather than a fixed gap because the two failure kinds want different patience: a mail
 * host that is briefly unreachable should be dialed again in a minute, and a host that is
 * unreachable for an afternoon should not be dialed every minute for that afternoon. Five waits, so
 * a row is asked at most six times and gives up inside a day of the news it carries.
 *
 * These numbers live here rather than in the sweep for the reason `PENDING_REQUEST_HOURS` lives next
 * to its own sweep: they are the answer to "how long will my confirmation take to arrive", which a
 * person asks an operator, and an operator should be able to answer it from one file.
 */
export const MAIL_RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360] as const;

/** How often the sweep wakes, in minutes. A five-minute wait between runs is what makes the
 * one-minute first retry mean something — a row due in a minute is picked up by the next run — and
 * it is the number the delivery spec checks the registered cron against. */
export const MAIL_SWEEP_INTERVAL_MINUTES = 5;

/** How many rows one run takes. A page rather than the whole queue because every row in a run is a
 * call to somebody else's server, and a burst of queued news should drain over several runs instead
 * of holding the process on a mail host that has decided to be slow. */
export const MAIL_DELIVERY_BATCH_SIZE = 25;

/** How long a row may sit in `sending` before another run treats the claim as abandoned.
 *
 * A claim is made by a status write, not by a lock that dies with its connection, so a process that
 * stopped mid-send leaves a row nobody is sending and nobody is retrying. The window is wider than a
 * run — a row claimed at the top of a page may still be legitimately in flight a few minutes later,
 * and taking it back would mail a person twice — and far short of a day, which is the most an
 * abandoned letter should stay silent. */
export const MAIL_SENDING_RECLAIM_MINUTES = 15;

/**
 * The wait before the attempt after this one, or `null` when there is no attempt after this one.
 *
 * `attemptsMade` is the column's own meaning: how many times the transport has been asked. A row that
 * has just failed its first ask waits a minute for its second, and a row reporting a sixth ask is out
 * of curve — `null` is how the sweep is told that the row is `failed` rather than due.
 *
 * A function rather than a second constant, because the budget and the curve are one fact: a number
 * of attempts written beside this list could disagree with it, and the disagreement would show up as
 * either a row that never stops retrying or one that stops early.
 */
export function mailRetryDelayMinutes(attemptsMade: number): number | null {
  if (attemptsMade < 1 || attemptsMade > MAIL_RETRY_DELAYS_MINUTES.length) return null;
  return MAIL_RETRY_DELAYS_MINUTES[attemptsMade - 1] ?? null;
}
