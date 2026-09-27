import { describe, expect, it } from 'vitest';

import {
  formatInZone,
  getZoneParts,
  instantAtLocalMinutes,
  isValidIanaTimeZone,
  localDateKey,
  shortZoneLabel,
  zoneDateKey,
  zoneDateOf,
  zoneOffsetMinutes,
} from './timezone';

describe('timezone display', () => {
  const utcNoon = '2026-03-15T12:00:00Z';

  it('renders the same instant differently per zone without touching the instant', () => {
    expect(getZoneParts(utcNoon, 'Asia/Kolkata')).toMatchObject({ hour: 17, minute: 30 });
    expect(getZoneParts(utcNoon, 'America/New_York')).toMatchObject({ hour: 8, minute: 0 });
    expect(getZoneParts(utcNoon, 'Europe/London')).toMatchObject({ hour: 12, minute: 0 });
  });

  it('follows DST, so the same wall-clock hour means different UTC instants', () => {
    // 2026-02-15 is EST (UTC-5); 2026-03-15 is EDT (UTC-4) after the 8 March US transition.
    expect(getZoneParts('2026-02-15T12:00:00Z', 'America/New_York').hour).toBe(7);
    expect(getZoneParts('2026-03-15T12:00:00Z', 'America/New_York').hour).toBe(8);
  });

  it('handles a hemisphere-swapped zone, where March exits summer time', () => {
    // Sydney: AEDT (UTC+11) until 5 April 2026, so 15 March is still +11.
    expect(getZoneParts(utcNoon, 'Australia/Sydney')).toMatchObject({ hour: 23, day: 15 });
    expect(getZoneParts('2026-04-05T12:00:00Z', 'Australia/Sydney')).toMatchObject({ hour: 22 });
  });

  it('rolls the calendar day forward when the zone demands it', () => {
    const parts = getZoneParts('2026-12-31T20:00:00Z', 'Asia/Kolkata');
    expect(parts).toMatchObject({ year: 2027, month: 1, day: 1, hour: 1, minute: 30 });
  });

  it('exposes a single display label shape for the UI', () => {
    const formatted = formatInZone(utcNoon, 'Asia/Kolkata', 'en-US');
    expect(formatted.time).toBe('5:30 PM');
    expect(formatted.date).toBe('Mar 15, 2026');
    expect(formatted.weekday).toBe('Sun');
    expect(formatted.label).toBe('Sun, Mar 15, 2026 · 5:30 PM GMT+5:30');
  });

  it('labels the zone with its offset for that instant', () => {
    expect(shortZoneLabel(utcNoon, 'Asia/Kolkata')).toBe('GMT+5:30');
    expect(shortZoneLabel('2026-01-10T12:00:00Z', 'America/New_York')).toBe('GMT-5');
  });

  it('computes signed offset minutes, including half-hour zones', () => {
    expect(zoneOffsetMinutes(utcNoon, 'Asia/Kolkata')).toBe(330);
    expect(zoneOffsetMinutes('2026-07-01T12:00:00Z', 'America/New_York')).toBe(-240);
    // UK summer time begins 29 March 2026, so mid-March London is still on GMT.
    expect(zoneOffsetMinutes(utcNoon, 'Europe/London')).toBe(0);
    expect(zoneOffsetMinutes('2026-07-01T12:00:00Z', 'Europe/London')).toBe(60);
  });

  it('rejects bogus zone names instead of silently falling back to the server zone', () => {
    expect(isValidIanaTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidIanaTimeZone('Delhi')).toBe(false);
    expect(() => getZoneParts(utcNoon, 'Mars/Olympus')).toThrow();
  });

  it('refuses to guess at a non-instant', () => {
    expect(() => formatInZone('not-a-date', 'Asia/Kolkata')).toThrow();
  });
});

/**
 * A calendar column is a date in somebody's zone before it is an instant, and the two ways a
 * screen asks about one — "which date is this slot" and "which date is this column" — must give
 * the same string or the slot lands on the wrong Tuesday.
 */
describe('local dates', () => {
  it('names the zone calendar date an instant falls on', () => {
    expect(zoneDateOf('2026-09-28T04:00:00Z', 'Asia/Kolkata')).toEqual({
      year: 2026,
      month: 9,
      day: 28,
    });
    // Twenty:00 UTC is already the next morning in Kolkata: the day belongs to the zone, not to
    // the UTC midnight that a naive `toISOString().slice(0, 10)` would have used.
    expect(zoneDateOf('2026-09-28T20:00:00Z', 'Asia/Kolkata')).toEqual({
      year: 2026,
      month: 9,
      day: 29,
    });
  });

  it('writes a zone date as a padded key', () => {
    expect(zoneDateKey('2026-09-05T20:00:00Z', 'Asia/Kolkata')).toBe('2026-09-06');
    expect(zoneDateKey('2027-01-01T00:00:00Z', 'Pacific/Kiritimati')).toBe('2027-01-01');
    expect(localDateKey({ year: 2026, month: 12, day: 1 })).toBe('2026-12-01');
  });

  it('agrees with itself whichever way the question was asked', () => {
    const zone = 'America/New_York';
    const date = { year: 2026, month: 3, day: 14 };
    // A whole day of instants, read back, all land on the same key the column would carry.
    for (const minutes of [0, 8 * 60 + 30, 23 * 60 + 59]) {
      const instant = instantAtLocalMinutes(zone, date, minutes);
      expect(zoneDateKey(instant, zone)).toBe(localDateKey(date));
    }
  });
});
