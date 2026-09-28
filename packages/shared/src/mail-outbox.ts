/**
 * The states a queued notification passes through.
 *
 * This list is not a lookup type, and the reason is worth keeping: `Lkp*` exists so Ops can add a
 * value without a migration, and nobody can add a value here without writing the sweep code that
 * would honour it. A status whose only writer is a scheduler is a step in a program, not a piece of
 * reference data an operator maintains — so it sits next to the code that moves rows between these
 * states rather than in a table they could retire.
 *
 * Which states a row may move between, and how many times it may be tried, are the delivery sweep's
 * decisions (ARCHITECTURE §6, Phase 6e). Nothing in this list says what happens next.
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
