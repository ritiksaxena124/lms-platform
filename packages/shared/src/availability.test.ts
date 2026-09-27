import { describe, expect, it } from 'vitest';

import {
  MAX_WEEKDAY,
  minutesFromWallClock,
  MIN_WEEKDAY,
  wallClock,
  WEEKDAY_LABELS,
  weekdayLabel,
} from './availability';

describe('wallClock', () => {
  it('reads minutes from midnight as a clock face', () => {
    expect(wallClock(0)).toBe('00:00');
    expect(wallClock(540)).toBe('09:00');
    expect(wallClock(545)).toBe('09:05');
    expect(wallClock(1380)).toBe('23:00');
  });

  it('reads the midnight a through-the-night window closes at as 24:00', () => {
    // `00:00` would be the minute it opened, which is a different sentence about a range.
    expect(wallClock(1440)).toBe('24:00');
  });
});

describe('minutesFromWallClock', () => {
  it('is the way back, so a form field and a stored window cannot disagree', () => {
    for (const minutes of [0, 540, 545, 1380, 1439]) {
      expect(minutesFromWallClock(wallClock(minutes))).toBe(minutes);
    }
  });

  it('accepts the midnight a window closes at, which is 24:00 and not 00:00', () => {
    expect(minutesFromWallClock('24:00')).toBe(1440);
    expect(minutesFromWallClock('00:00')).toBe(0);
  });

  it('refuses a face that is not a time, rather than reading it as midnight', () => {
    // A form that turned `9am` into 0 would open a window at the start of every day.
    expect(minutesFromWallClock('')).toBeNull();
    expect(minutesFromWallClock('9:00')).toBeNull();
    expect(minutesFromWallClock('09:60')).toBeNull();
    expect(minutesFromWallClock('25:00')).toBeNull();
    expect(minutesFromWallClock('9am')).toBeNull();
  });
});

describe('weekdayLabel', () => {
  it('names the seven days in the order the table numbers them', () => {
    expect(WEEKDAY_LABELS).toHaveLength(7);
    expect(weekdayLabel(MIN_WEEKDAY)).toBe('Monday');
    expect(weekdayLabel(MAX_WEEKDAY)).toBe('Sunday');
  });

  it('does not pretend a day that does not exist has a name', () => {
    expect(weekdayLabel(8)).toBe('Day 8');
  });
});
