import { describe, expect, it } from 'vitest';

import {
  BLOCKING_BOOKING_STATUSES,
  BOOKING_STATUS_CODES,
  BOOKING_TYPE_CODES,
  CANCELLABLE_BOOKING_STATUSES,
  ROLE_CODES,
  SCHEDULABLE_BOOKING_STATUSES,
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
      'expired',
      'no_show',
    ]);
  });

  it('releases a minute the teacher refused or never answered', () => {
    // A request that was said no to, or left unanswered until the sweep released it, has to give
    // the instant back — otherwise a teacher's silence would keep blocking a calendar forever.
    expect(BLOCKING_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.REJECTED);
    expect(BLOCKING_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.EXPIRED);
  });

  it('lets a student out of a request or a class, and out of nothing else', () => {
    // The set is the answer to "is leaving still an action", which is a different question from
    // "is this minute occupied" — a class that has been taught holds no minute and cannot be
    // cancelled either.
    expect([...CANCELLABLE_BOOKING_STATUSES].sort()).toEqual(['confirmed', 'pending']);
    expect(CANCELLABLE_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.COMPLETED);
    expect(CANCELLABLE_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.NO_SHOW);
    expect(CANCELLABLE_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.REJECTED);
    expect(CANCELLABLE_BOOKING_STATUSES).not.toContain(BOOKING_STATUS_CODES.EXPIRED);
  });

  it('seeds every status Phase 4 can move a booking into', () => {
    // The sweep writes `expired`, and a teacher's refusal writes `rejected`. A status no code can
    // reach is the drift lookups exist to prevent, and a status some code does reach had no row
    // until the confirm flow existed.
    expect(SCHEDULABLE_BOOKING_STATUSES).toContain(BOOKING_STATUS_CODES.REJECTED);
    expect(SCHEDULABLE_BOOKING_STATUSES).toContain(BOOKING_STATUS_CODES.EXPIRED);
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
