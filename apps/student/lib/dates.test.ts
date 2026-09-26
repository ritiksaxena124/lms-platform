import { describe, expect, it } from 'vitest';

import { formatDay } from './dates';

/**
 * Days as the reader counts them.
 *
 * An instant is an instant everywhere; the date a student remembers is not. `2026-09-20T18:00Z`
 * is the 21st in Kolkata and still the 20th in London, and a list that showed the wrong one
 * would be a record the person on the other end does not recognise.
 */
describe('formatDay', () => {
  it('names the date in the timezone it was asked for', () => {
    // One instant, two calendars: after midnight in Kolkata, still the evening before in
    // London. A record shown in the wrong one is a date the reader does not remember.
    expect(formatDay('2026-09-20T20:00:00.000Z', 'Asia/Kolkata')).toBe('21 Sept 2026');
    expect(formatDay('2026-09-20T20:00:00.000Z', 'Europe/London')).toBe('20 Sept 2026');
  });

  it('keeps a date it cannot place out of the way, rather than showing a dash', () => {
    // A broken or absent timezone is the browser's own, which is the only other answer a
    // person reading this screen could check against their wall.
    expect(formatDay('2026-09-20T20:00:00.000Z', 'Mars/Olympus')).toMatch(/20|21 Sept 2026/);
    expect(formatDay('2026-09-20T20:00:00.000Z', null)).toMatch(/20|21 Sept 2026/);
  });
});
