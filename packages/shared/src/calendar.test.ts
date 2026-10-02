import { describe, expect, it } from 'vitest';

import {
  expandSeries,
  holidayOn,
  seriesWindow,
  type HolidayPattern,
  type SeriesPattern,
} from './calendar';
import { getZoneParts } from './timezone';

/**
 * The arithmetic that turns a recorded pattern — "Mondays, 09:00 to 11:00, an hour each" — into
 * the dated classes a cohort actually has.
 *
 * This file exists because a series is the only scheduling object in the platform that is *stored*
 * rather than generated, and the moment something is stored the questions get sharper than the
 * availability grid ever asked them: does a holiday written as a date stop a class whose instant
 * sits on a different date in UTC, does a recurring holiday mean anything at all, and does a class
 * on the spring-forward weekend exist. Every answer here is a rule the cron that fills the
 * calendar and the screens that read it will share, so that a teacher who marks a day off is never
 * shown a class on it by one of them and not the other.
 */
const series = (overrides: Partial<SeriesPattern> = {}): SeriesPattern => ({
  weekday: 1,
  startMinutes: 9 * 60,
  endMinutes: 11 * 60,
  durationMinutes: 60,
  isActive: true,
  ...overrides,
});

const holiday = (date: string, overrides: Partial<HolidayPattern> = {}): HolidayPattern => ({
  date,
  isRecurringAnnual: false,
  isActive: true,
  ...overrides,
});

/** Kolkata's Mondays, 05 and 12 October — two weeks so a dropped week is a gap rather than an
 * empty answer that could also be a broken horizon. The bounds are instants: `04 Oct 18:30Z` is
 * where Monday 05 Oct begins on the teacher's clock. */
const TWO_WEEKS = {
  from: new Date('2026-10-04T18:30:00.000Z'),
  to: new Date('2026-10-18T18:30:00.000Z'),
};

const startsOf = (
  pattern: SeriesPattern,
  timeZone: string,
  horizon: { from: Date; to: Date },
  holidays: HolidayPattern[] = [],
) => expandSeries(pattern, timeZone, horizon, holidays).map((slot) => slot.startsAt.toISOString());

describe('series window', () => {
  it('offers the pattern to the same tiling the availability grid uses', () => {
    expect(seriesWindow(series())).toEqual({
      weekday: 1,
      startMinutes: 540,
      endMinutes: 660,
      // The class length, not the window: a series says how long one class is and the window is
      // only the container it is repeated inside.
      slotMinutes: 60,
    });
  });
});

describe('series expansion', () => {
  it('opens one class per tile of its own length inside the window, every matching week', () => {
    expect(startsOf(series(), 'Asia/Kolkata', TWO_WEEKS)).toEqual([
      '2026-10-05T03:30:00.000Z',
      '2026-10-05T04:30:00.000Z',
      '2026-10-12T03:30:00.000Z',
      '2026-10-12T04:30:00.000Z',
    ]);
  });

  it('keeps a class running for the length the series set', () => {
    const slots = expandSeries(series({ durationMinutes: 45 }), 'Asia/Kolkata', TWO_WEEKS);

    // 45 minutes of real time, so the second class of the window starts at the face the first
    // one's length moved it to rather than at the wall's next hour.
    expect(
      slots.map((slot) => [
        getZoneParts(slot.startsAt, 'Asia/Kolkata'),
        slot.endsAt.getTime() - slot.startsAt.getTime(),
      ]),
    ).toEqual([
      [{ year: 2026, month: 10, day: 5, hour: 9, minute: 0, second: 0 }, 45 * 60_000],
      [{ year: 2026, month: 10, day: 5, hour: 9, minute: 45, second: 0 }, 45 * 60_000],
      [{ year: 2026, month: 10, day: 12, hour: 9, minute: 0, second: 0 }, 45 * 60_000],
      [{ year: 2026, month: 10, day: 12, hour: 9, minute: 45, second: 0 }, 45 * 60_000],
    ]);
  });

  it('opens nothing for a retired pattern', () => {
    // Retirement is a flag on the row rather than a delete, so the generator has to be the one
    // that knows a closed series means no classes.
    expect(startsOf(series({ isActive: false }), 'Asia/Kolkata', TWO_WEEKS)).toEqual([]);
  });

  it('refuses a horizon that has no room in it', () => {
    const same = {
      from: new Date('2026-10-05T03:30:00.000Z'),
      to: new Date('2026-10-05T03:30:00.000Z'),
    };
    expect(startsOf(series(), 'Asia/Kolkata', same)).toEqual([]);
  });
});

describe('holidays', () => {
  it('finds a holiday by the local date it names', () => {
    const diwali = holiday('2026-10-12');

    expect(holidayOn([diwali], '2026-10-12')).toBe(diwali);
    expect(holidayOn([diwali], '2026-10-05')).toBeNull();
    expect(holidayOn([], '2026-10-12')).toBeNull();
  });

  it('drops the week whose date is marked off', () => {
    expect(startsOf(series(), 'Asia/Kolkata', TWO_WEEKS, [holiday('2026-10-05')])).toEqual([
      '2026-10-12T03:30:00.000Z',
      '2026-10-12T04:30:00.000Z',
    ]);
  });

  it('counts an annual holiday in the years after the one it was stored for', () => {
    const blocked = [holiday('2025-10-12', { isRecurringAnnual: true })];

    expect(startsOf(series(), 'Asia/Kolkata', TWO_WEEKS, blocked)).toEqual([
      '2026-10-05T03:30:00.000Z',
      '2026-10-05T04:30:00.000Z',
    ]);
    // The same date written for one year only, by contrast, is one Wednesday in 2025 and nothing
    // in 2026 — otherwise a teacher marking off a funeral could close the day forever.
    expect(startsOf(series(), 'Asia/Kolkata', TWO_WEEKS, [holiday('2025-10-12')])).toEqual([
      '2026-10-05T03:30:00.000Z',
      '2026-10-05T04:30:00.000Z',
      '2026-10-12T03:30:00.000Z',
      '2026-10-12T04:30:00.000Z',
    ]);
  });

  it('stops blocking once a holiday is retired', () => {
    const cancelled = [holiday('2026-10-05', { isActive: false })];

    expect(startsOf(series(), 'Asia/Kolkata', TWO_WEEKS, cancelled)).toHaveLength(4);
    expect(holidayOn(cancelled, '2026-10-05')).toBeNull();
  });

  it('marks a class off by the day on the clock the teacher lives on, not the stored instant', () => {
    // A class that begins at 00:30 in Kolkata is 19:00 the previous day in UTC. The date column
    // holds a teacher's day, so it is the teacher's day that decides — a holiday written for the
    // UTC date would close the wrong class, and one written for the local date must close it.
    const early = series({ startMinutes: 30, endMinutes: 60, durationMinutes: 30 });
    const slots = expandSeries(early, 'Asia/Kolkata', TWO_WEEKS);

    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-10-04T19:00:00.000Z',
      '2026-10-11T19:00:00.000Z',
    ]);
    expect(startsOf(early, 'Asia/Kolkata', TWO_WEEKS, [holiday('2026-10-04')])).toHaveLength(2);
    expect(startsOf(early, 'Asia/Kolkata', TWO_WEEKS, [holiday('2026-10-05')])).toEqual([
      '2026-10-11T19:00:00.000Z',
    ]);
  });

  it('is read as a day in the zone, for a class whose UTC date is the day after', () => {
    // The mirror of the case above: a Monday evening class in New York is stored as a Tuesday
    // morning instant. Blocking it by the stored date would ask the teacher to mark off the wrong
    // day, and the teacher's own calendar would say the class was simply missing.
    const evening = series({ startMinutes: 21 * 60, endMinutes: 22 * 60 });
    const week = {
      from: new Date('2026-10-05T00:00:00.000Z'),
      to: new Date('2026-10-12T00:00:00.000Z'),
    };

    expect(startsOf(evening, 'America/New_York', week)).toEqual(['2026-10-06T01:00:00.000Z']);
    expect(startsOf(evening, 'America/New_York', week, [holiday('2026-10-06')])).toHaveLength(1);
    expect(startsOf(evening, 'America/New_York', week, [holiday('2026-10-05')])).toEqual([]);
  });
});

describe('the awkward clock', () => {
  it('opens nothing on a minute the zone skipped', () => {
    // Sunday 08 March 2026 in New York: 02:00 does not happen, so a series that lives at 02:30 has
    // no class that week. The pattern row stays exactly as it was, and the following week is on
    // time — which is the whole argument for generating dated classes from a pattern rather than
    // storing the pattern's own dates.
    const skipped = series({ weekday: 7, startMinutes: 150, endMinutes: 180, durationMinutes: 30 });
    const thatSunday = {
      from: new Date('2026-03-08T05:00:00.000Z'),
      to: new Date('2026-03-09T05:00:00.000Z'),
    };

    expect(startsOf(skipped, 'America/New_York', thatSunday)).toEqual([]);

    const after = series({ weekday: 7, startMinutes: 180, endMinutes: 210, durationMinutes: 30 });
    expect(startsOf(after, 'America/New_York', thatSunday)).toEqual(['2026-03-08T07:00:00.000Z']);
  });
});
