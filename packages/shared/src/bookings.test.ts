import { describe, expect, it } from 'vitest';

import { BOOKING_STATUS_LABELS } from './bookings';
import { BOOKING_STATUS_CODES } from './lookup-codes';

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
