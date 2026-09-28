import { describe, expect, it } from 'vitest';

import { formatClassWindow, formatDay, formatInstant } from './dates';

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

/**
 * A class is a window with a person in it, and a teacher wrote their windows in twenty-four
 * hours. A queue that read "9:00 am" under a grid drawn "09:00–11:00" would be two dialects for
 * one set of numbers, and the second one is the easier to misread.
 */
describe('formatClassWindow', () => {
  it('names the day and both clock faces in the zone it was asked for', () => {
    // 03:30Z and 04:15Z are 09:00 and 09:45 in Kolkata, and 1 Oct 2026 is a Thursday.
    expect(
      formatClassWindow('2026-10-01T03:30:00.000Z', '2026-10-01T04:15:00.000Z', 'Asia/Kolkata'),
    ).toBe('Thu 1 Oct, 09:00–09:45');
  });

  it('moves the whole class with the zone, rather than only its clock face', () => {
    // 20:00Z on a Sunday is twenty past one on Monday in Kolkata, so the day belongs to the zone
    // as much as the hour does. London is on summer time that weekend and stays on the Sunday.
    expect(
      formatClassWindow('2026-09-20T20:00:00.000Z', '2026-09-20T20:45:00.000Z', 'Asia/Kolkata'),
    ).toBe('Mon 21 Sept, 01:30–02:15');
    expect(
      formatClassWindow('2026-09-20T20:00:00.000Z', '2026-09-20T20:45:00.000Z', 'Europe/London'),
    ).toBe('Sun 20 Sept, 21:00–21:45');
  });

  it('falls back to the readers own clock for a zone it cannot place', () => {
    expect(
      formatClassWindow('2026-10-01T03:30:00.000Z', '2026-10-01T04:15:00.000Z', 'Mars/Olympus'),
    ).toMatch(/^Wed|Thu 1 Oct, \d{2}:\d{2}–\d{2}:\d{2}$/);
  });
});

/**
 * One instant, written the way the window beside it is written.
 *
 * The live class door opens a few minutes before the class does, and a screen that says "09:25"
 * under a row reading "Mon 5 Oct, 09:30–10:15" is two formats for one clock again.
 */
describe('formatInstant', () => {
  it('names the day and the face, in the zone it was asked for', () => {
    expect(formatInstant('2026-10-05T03:55:00.000Z', 'Asia/Kolkata')).toBe('Mon 5 Oct, 09:25');
  });

  it('moves the day with the zone, not only the hour', () => {
    expect(formatInstant('2026-09-20T20:00:00.000Z', 'Asia/Kolkata')).toBe('Mon 21 Sept, 01:30');
    expect(formatInstant('2026-09-20T20:00:00.000Z', 'Europe/London')).toBe('Sun 20 Sept, 21:00');
  });

  it('falls back to the readers own clock for a zone it cannot place', () => {
    expect(formatInstant('2026-10-01T03:30:00.000Z', 'Mars/Olympus')).toMatch(
      /^Wed|Thu 1 Oct, \d{2}:\d{2}$/,
    );
  });
});
