import { describe, expect, it } from 'vitest';

import { MAX_WEEKDAY, MIN_WEEKDAY, wallClock, WEEKDAY_LABELS, weekdayLabel } from './availability';

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
