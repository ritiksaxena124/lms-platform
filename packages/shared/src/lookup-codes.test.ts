import { describe, expect, it } from 'vitest';

import {
  BLOCKING_BOOKING_STATUSES,
  BOOKING_STATUS_CODES,
  LKP_TYPE_CODES,
  type LkpTypeCode,
  ROLE_CODES,
  validateLookupSeeds,
} from './lookup-codes';

describe('lookup reference codes', () => {
  it('uses string codes so they can mirror LkpValue rows, not TS enums', () => {
    for (const code of Object.values(BOOKING_STATUS_CODES)) {
      expect(typeof code).toBe('string');
    }
    expect(Object.values(ROLE_CODES)).toEqual(['student', 'teacher', 'ops']);
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

  it('fails loudly when a reference type has no seeded values', () => {
    const complete = Object.fromEntries(
      Object.values(LKP_TYPE_CODES).map((type) => [type, ['placeholder']]),
    ) as Record<LkpTypeCode, string[]>;

    expect(() => validateLookupSeeds(complete)).not.toThrow();
    delete (complete as Record<string, string[]>).BookingStatus;
    expect(() => validateLookupSeeds(complete as never)).toThrow(/BookingStatus/);
  });
});
