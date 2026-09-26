import { describe, expect, it } from 'vitest';

import { formatDay } from './dates';

/**
 * The teacher's own copy of the one date format a portal shows a person.
 *
 * `apps/student` has the same twenty lines for the same reason, and each app owns its
 * presentation the way each owns its `lib/api.ts`: the design kit must not grow a dependency on
 * the domain package to format a day.
 *
 * An instant is an instant everywhere; the date a teacher remembers is not. A roster shown in
 * the wrong zone is a class list whose dates nobody in it recognises.
 */
describe('formatDay', () => {
  it('names the date in the timezone it was asked for', () => {
    expect(formatDay('2026-09-20T20:00:00.000Z', 'Asia/Kolkata')).toBe('21 Sept 2026');
    expect(formatDay('2026-09-20T20:00:00.000Z', 'Europe/London')).toBe('20 Sept 2026');
  });

  it('keeps a date it cannot place out of the way, rather than showing a dash', () => {
    // A broken or absent zone is the browser's own, which is the only other answer the person
    // reading this screen could check against their wall.
    expect(formatDay('2026-09-20T20:00:00.000Z', 'Mars/Olympus')).toMatch(/20|21 Sept 2026/);
    expect(formatDay('2026-09-20T20:00:00.000Z', null)).toMatch(/20|21 Sept 2026/);
  });
});
