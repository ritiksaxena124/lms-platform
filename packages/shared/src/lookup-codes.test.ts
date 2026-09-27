import { describe, expect, it } from 'vitest';

import {
  BLOCKING_BOOKING_STATUSES,
  BOOKING_STATUS_CODES,
  BOOKING_TYPE_CODES,
  ROLE_CODES,
  SELF_REGISTERABLE_ROLES,
  validateLookupSeeds,
} from './lookup-codes';

describe('lookup reference codes', () => {
  it('uses string codes so they can mirror LkpValue rows, not TS enums', () => {
    for (const code of Object.values(BOOKING_STATUS_CODES)) {
      expect(typeof code).toBe('string');
    }
    expect(Object.values(ROLE_CODES)).toEqual(['student', 'teacher', 'ops']);
  });

  it('names the two kinds of booking the schedule answers to', () => {
    // `enrolled` needs a place in the course; `demo` is a one-time trial for a student who
    // does not hold one. The pair, not a boolean, because the entitlement rules differ and
    // Ops may add a third kind of booking without a code change.
    expect(Object.values(BOOKING_TYPE_CODES)).toEqual([
      BOOKING_TYPE_CODES.ENROLLED,
      BOOKING_TYPE_CODES.DEMO,
    ]);
    expect(typeof BOOKING_TYPE_CODES.ENROLLED).toBe('string');
  });

  it('keeps a completed booking off the blocking set, so its slot is not held forever', () => {
    expect(BLOCKING_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.COMPLETED);
    expect(BLOCKING_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.CANCELLED);
    expect(BLOCKING_BOOKING_STATUSES).toContain(BOOKING_STATUS_CODES.CONFIRMED);
  });

  it('never lets a sign-up form ask for an ops account', () => {
    expect([...SELF_REGISTERABLE_ROLES]).toEqual(['student', 'teacher']);
    expect(SELF_REGISTERABLE_ROLES).not.toContain(ROLE_CODES.OPS);
  });

  it('only lets pending or confirmed bookings hold a slot', () => {
    expect([...BLOCKING_BOOKING_STATUSES].sort()).toEqual(['confirmed', 'pending']);
    expect(Object.values(BOOKING_STATUS_CODES)).toEqual([
      'pending',
      'confirmed',
      'completed',
      'cancelled',
      'rejected',
      'no_show',
    ]);
  });

  it('fails loudly when a reference type the application reads has no seeded values', () => {
    const seeded: Record<string, string[]> = {
      UserRole: ['student'],
      AccountStatus: ['active'],
    };

    expect(() => validateLookupSeeds(seeded, ['UserRole', 'AccountStatus'])).not.toThrow();
    expect(() => validateLookupSeeds(seeded, ['UserRole', 'BookingStatus'])).toThrow(
      /BookingStatus/,
    );
  });
});
