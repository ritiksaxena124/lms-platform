/**
 * The things this platform sends mail about.
 *
 * A code is the identity of a send decision, and three separate places have to agree on it without
 * any join between them: the transaction that files the news in `mail_outbox`, the `email_template`
 * row holding the copy the sweep will render, and the log line the mail port is allowed to carry
 * (ARCHITECTURE §6). This list is where they meet — the queue writes a code from here, the seed
 * files copy under the same string, and a sixth value added to either one without a seventh entry
 * here is a letter with nothing to say or a template nobody can reach.
 *
 * Like the outbox statuses beside it, this is not a `Lkp*` type: a new event is a new write in a
 * business transaction, so an operator adding a value here could only ever produce a row that no
 * code writes.
 */
export const MAIL_EVENT_CODES = {
  /** A student asked for a minute of a teacher's week. The teacher is the one who has to act. */
  BOOKING_REQUESTED: 'booking_requested',
  /** The teacher said yes. */
  BOOKING_CONFIRMED: 'booking_confirmed',
  /** The teacher said no. */
  BOOKING_REFUSED: 'booking_refused',
  /** Nobody said anything, and the hold ran out — a different news from a refusal, because a
   * silence was not somebody's answer. */
  BOOKING_EXPIRED: 'booking_expired',
  /** A student stood down a class the teacher was expecting. */
  BOOKING_CANCELLED: 'booking_cancelled',
  /** A student took a place in a course. */
  ENROLLMENT_JOINED: 'enrollment_joined',
  /** A student left one, which closes the pages that place opened. */
  ENROLLMENT_LEFT: 'enrollment_left',
} as const;

export type MailEventCode = (typeof MAIL_EVENT_CODES)[keyof typeof MAIL_EVENT_CODES];
