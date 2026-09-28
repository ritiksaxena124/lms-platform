import { describe, expect, it } from 'vitest';

import { formatClassWindow, formatDay, formatInstant } from './dates';

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

/**
 * When a class runs, on the clock of the person who has to be awake for it.
 *
 * The booking's own instants are UTC and the calendar that offered them was drawn in the
 * teacher's zone; this is the one place a student reads the class back in their own. Same shape
 * as the teacher's list of the same rows, because it is the same fact said to both ends of a
 * lesson.
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
 * One minute rather than a span, for the sentence "the door opens at".
 *
 * A live class has a window with two ends, and the thing a student needs from it is the near one:
 * a range would say when the class stops, which is not a fact anybody sets an alarm for. Same
 * words the teacher's list uses for the same instant, because the two ends of a lesson are looking
 * for the same knock.
 */
describe('formatInstant', () => {
  it('names the day and the face in the zone it was asked for', () => {
    expect(formatInstant('2026-10-01T03:25:00.000Z', 'Asia/Kolkata')).toBe('Thu 1 Oct, 08:55');
    expect(formatInstant('2026-10-01T03:25:00.000Z', 'Europe/London')).toBe('Thu 1 Oct, 04:25');
  });

  it('falls back to the readers own clock for a zone it cannot place', () => {
    expect(formatInstant('2026-10-01T03:25:00.000Z', 'Mars/Olympus')).toMatch(
      /^Wed|Thu 1 Oct, \d{2}:\d{2}$/,
    );
  });
});
