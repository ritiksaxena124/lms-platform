import { describe, expect, it } from 'vitest';

import { formatDay, formatInstant } from './dates';

/**
 * One instant, two faces, and the reader decides which.
 *
 * The instant on the wire is the same for every operator on the desk; the string they are shown is
 * not, and a screen that printed UTC would make an operator doing arithmetic in their head about a
 * class that ran at 09:30 in Kolkata. Both of these are the whole promise the ledger's clock makes.
 */
describe('the clock the ledger is read on', () => {
  it('prints the day and the minute in the zone the account names', () => {
    expect(formatInstant('2026-09-28T09:15:00.000Z', 'UTC')).toBe('Mon 28 Sept, 09:15');
    expect(formatInstant('2026-09-28T09:15:00.000Z', 'Asia/Kolkata')).toBe('Mon 28 Sept, 14:45');
  });

  it('crosses midnight when the zone does, rather than keeping the wire’s day', () => {
    // The row happened on the 28th in Kolkata and on the 28th in UTC only because the hour is
    // morning; late in the day the two disagree about the date, and an operator reading their own
    // clock must not be shown somebody else's.
    expect(formatInstant('2026-09-28T23:40:00.000Z', 'UTC')).toBe('Mon 28 Sept, 23:40');
    expect(formatInstant('2026-09-28T23:40:00.000Z', 'Asia/Kolkata')).toBe('Tue 29 Sept, 05:10');
  });

  it('gives a day a fact that is only a day', () => {
    expect(formatDay('2026-09-28T23:40:00.000Z', 'UTC')).toBe('28 Sept 2026');
    expect(formatDay('2026-09-28T23:40:00.000Z', 'Asia/Kolkata')).toBe('29 Sept 2026');
  });

  it('falls back to the browser’s own zone when the account names nothing it can trust', () => {
    // A malformed or unparseable zone is not a reason to print a bare instant or to throw: the
    // reader's machine already knows which clock they are sitting in.
    const instant = '2026-09-28T09:15:00.000Z';
    expect(formatInstant(instant, 'Not/AZone')).toBe(formatInstant(instant));
    expect(formatInstant(instant, null)).toBe(formatInstant(instant));
    expect(formatDay(instant, 'Not/AZone')).toBe(formatDay(instant));
  });

  it('never shows a second, because no row of this log is a race', () => {
    expect(formatInstant('2026-09-28T09:15:59.000Z', 'UTC')).toBe(
      formatInstant('2026-09-28T09:15:01.000Z', 'UTC'),
    );
  });
});
