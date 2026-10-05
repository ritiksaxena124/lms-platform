import { describe, expect, it } from 'vitest';

import { BOOKING_MARK_CODES, BOOKING_STATUS_LABELS, type BookingMarkCode } from './bookings';
import { BOOKING_STATUS_CODES, type BookingStatusCode } from './lookup-codes';

/**
 * The words a class list is written in.
 *
 * A booking arrives as bare codes — `status` is a string, where a course ships `{code, label}` —
 * because the rows that hold a booking's own words live in the database, and the booking payload
 * was cut before anyone needed them on screen. A class list needs them, so the map lives here
 * rather than in a portal: three apps inventing "Declined", "Missed" and "Called off" for one
 * status is how a student stops trusting what the screen says about their own calendar.
 */
describe('BOOKING_STATUS_LABELS', () => {
  it('names every status the API can put on a booking, and nothing else', () => {
    expect(Object.keys(BOOKING_STATUS_LABELS).sort()).toEqual(
      Object.values(BOOKING_STATUS_CODES).sort(),
    );
  });

  it('writes a code with an underscore the way a person would say it', () => {
    // `no_show` is a database code; a class list that printed it unchanged would read as a
    // malfunction rather than as a class nobody attended.
    expect(BOOKING_STATUS_LABELS[BOOKING_STATUS_CODES.NO_SHOW]).toBe('No show');
    expect(BOOKING_STATUS_LABELS[BOOKING_STATUS_CODES.PENDING]).toBe('Pending');
    expect(BOOKING_STATUS_LABELS[BOOKING_STATUS_CODES.CONFIRMED]).toBe('Confirmed');
  });
});

/**
 * The two words a teacher may put on a class that has happened.
 *
 * A mark is not a free choice of status, and the list exists to say so before a route does:
 * `cancelled` is a student's decision, `confirmed` and `rejected` are the teacher's answer to an
 * ask, `expired` is a clock's, and an endpoint that took any of them from a body would be a way for
 * one person to write another person's ending onto a row.
 */
describe('BOOKING_MARK_CODES', () => {
  it('offers the two endings and nothing else', () => {
    expect(Object.values(BOOKING_MARK_CODES)).toEqual([
      BOOKING_STATUS_CODES.COMPLETED,
      BOOKING_STATUS_CODES.NO_SHOW,
    ]);
  });

  it('keeps the marks inside the status vocabulary rather than beside it', () => {
    // The class list a student reads prints its pill out of BOOKING_STATUS_LABELS. A mark with a
    // vocabulary of its own would be a class ending in a word no list knows how to say.
    for (const code of Object.values(BOOKING_MARK_CODES) as BookingMarkCode[]) {
      expect(Object.values(BOOKING_STATUS_CODES)).toContain(code);
      expect(BOOKING_STATUS_LABELS[code as BookingStatusCode]).toBeTruthy();
    }
  });
});
