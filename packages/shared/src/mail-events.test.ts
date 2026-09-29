import { describe, expect, it } from 'vitest';

import {
  MAIL_EVENT_CODES,
  MAIL_EVENT_LABELS,
  mailEventLabel,
  type MailEventCode,
} from './mail-events';

/**
 * The seven things this platform sends mail about.
 *
 * This list is what a `mail_outbox` row's `event_code` and an `email_template` row's `event_code`
 * are both answers to, and it is the only place the two are tied together: the queue writes a code
 * from here, the seed files copy under the same code, and nothing in the database can join them.
 */
describe('mail event codes', () => {
  it('names every send decision the business writes make, and none a caller invented', () => {
    expect(Object.values(MAIL_EVENT_CODES)).toEqual([
      'booking_requested',
      'booking_confirmed',
      'booking_refused',
      'booking_expired',
      'booking_cancelled',
      'enrollment_joined',
      'enrollment_left',
    ]);
  });

  it('separates a class a student left from a course a student left', () => {
    // Both are "cancelled" in a person's mouth and neither in the queue's: one costs a teacher a
    // hour of their week and the other closes pages the student had open. A code that meant both
    // would put the wrong sentence in front of somebody who booked a class.
    expect(MAIL_EVENT_CODES.BOOKING_CANCELLED).not.toBe(MAIL_EVENT_CODES.ENROLLMENT_LEFT);
  });

  it('separates a teacher saying no from a teacher saying nothing', () => {
    // The student reads these two differently, and the copy has to: one is a refusal that came from
    // a person, the other a request that ran out on a clock.
    expect(MAIL_EVENT_CODES.BOOKING_REFUSED).not.toBe(MAIL_EVENT_CODES.BOOKING_EXPIRED);
  });

  it('wears the shape an `event_code` column is keyed on', () => {
    // A code is a lookup key in two tables and a log field on the mail port, so it has to be safe
    // to grep for and free of anything a `{slot}` name could be confused with.
    for (const code of Object.values(MAIL_EVENT_CODES) as MailEventCode[]) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('gives the queue screen a phrase for every code, and one for a code that is not a code', () => {
    // The table takes any string in this column, so a reader that insisted on this list would fail
    // a whole page of the queue over one hand-written row. The phrase for a row nobody declared is
    // the row's own string.
    expect(Object.keys(MAIL_EVENT_LABELS).sort()).toEqual(
      [...Object.values(MAIL_EVENT_CODES)].sort(),
    );
    expect(mailEventLabel(MAIL_EVENT_CODES.BOOKING_EXPIRED)).toBe('Request expired');
    expect(mailEventLabel('invented_by_a_report')).toBe('invented_by_a_report');
  });
});
