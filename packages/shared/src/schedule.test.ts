import { describe, expect, it } from 'vitest';

import {
  BOOKING_HORIZON_DAYS,
  PENDING_REQUEST_HOURS,
  SLOT_DAYS_PER_WEEK,
  expandWindows,
  isWindowStart,
  type SlotInstant,
  type WeeklyWindow,
} from './schedule';
import { formatInZone, getZoneParts } from './timezone';

/**
 * The arithmetic that turns "I keep Monday 09:00–10:30 open for half-hour classes" into the
 * instants a student is offered. Two things make this worth its own module rather than a line in
 * the endpoint: a wall clock is not an instant, so every tile has to be resolved through the
 * teacher's real zone — which means the days a zone skips, repeats and shifts by half an hour are
 * this file's business, not an edge case somebody discovers in production — and the same numbers
 * must decide both what is offered and what a booking is allowed to name, or a student could book
 * an instant the calendar never showed.
 */
const window = (overrides: Partial<WeeklyWindow> = {}): WeeklyWindow => ({
  weekday: 1,
  startMinutes: 9 * 60,
  endMinutes: 10 * 60 + 30,
  slotMinutes: 30,
  ...overrides,
});

/** A whole local week in Kolkata, whose offset never moves. */
const WEEK = {
  from: new Date('2026-10-04T18:30:00.000Z'), // Monday 05 Oct, 00:00 in Kolkata
  to: new Date('2026-10-05T18:30:00.000Z'),
};

const startsOf = (windows: WeeklyWindow[], timeZone: string, horizon: { from: Date; to: Date }) =>
  expandWindows(windows, timeZone, horizon).map((slot) => slot.startsAt.toISOString());

/** An index read in a spec is a claim that the grid has that row in it, so let it say so rather
 * than quieting the compiler with `!` at every call site. */
function slotAt(slots: SlotInstant[], index: number): SlotInstant {
  const slot = slots[index];
  if (!slot) throw new Error(`No slot at ${index}; the grid came back shorter than expected.`);
  return slot;
}

describe('availability window expansion', () => {
  it('tiles a window into classes of the length the teacher set', () => {
    const slots = expandWindows([window()], 'Asia/Kolkata', WEEK);

    // 09:00, 09:30 and 10:00, and nothing at 10:30: the last class has to finish inside the
    // window, so a teacher who wrote "open until 10:30" is not offering a class that would run
    // past it.
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-10-05T03:30:00.000Z',
      '2026-10-05T04:00:00.000Z',
      '2026-10-05T04:30:00.000Z',
    ]);
    expect(slots.map((slot) => slot.endsAt.toISOString())).toEqual([
      '2026-10-05T04:00:00.000Z',
      '2026-10-05T04:30:00.000Z',
      '2026-10-05T05:00:00.000Z',
    ]);
    // The clock face a student reads, which is what the teacher meant by Monday morning.
    expect(slots.map((slot) => formatInZone(slot.startsAt, 'Asia/Kolkata').time)).toEqual([
      '9:00 am',
      '9:30 am',
      '10:00 am',
    ]);
  });

  it('keeps the same clock face and different instants for two teachers', () => {
    const kolkata = expandWindows([window()], 'Asia/Kolkata', WEEK);
    const lisbon = expandWindows([window()], 'Europe/Lisbon', WEEK);

    // Two teachers writing identical numbers are teaching at different moments, and neither is
    // wrong. A shared UTC range stored on the rule would have made one of them a lie.
    expect(startsOf([window()], 'Asia/Kolkata', WEEK)).not.toEqual(
      startsOf([window()], 'Europe/Lisbon', WEEK),
    );
    expect(
      kolkata.map((slot) => getZoneParts(slot.startsAt, 'Asia/Kolkata')).map((parts) => parts.hour),
    ).toEqual([9, 9, 10]);
    expect(
      lisbon.map((slot) => getZoneParts(slot.startsAt, 'Europe/Lisbon')).map((parts) => parts.hour),
    ).toEqual([9, 9, 10]);
  });

  it('drops a class whose wall clock the spring-forward skipped, and keeps its neighbours', () => {
    // United States Eastern, 8 March 2026: 02:00 does not exist, the clock goes 01:59:59 ->
    // 03:00. An hour-tiled window therefore offers three starts and then two.
    // A whole local week (Monday 02 to Monday 09, 00:00 on the zone's own clocks), so the
    // Sunday's classes are inside the range even though they fall after 05:00 UTC.
    const localWeek = {
      from: new Date('2026-03-02T05:00:00.000Z'),
      to: new Date('2026-03-09T05:00:00.000Z'),
    };
    const starts = startsOf(
      [window({ weekday: 7, startMinutes: 60, endMinutes: 4 * 60, slotMinutes: 60 })],
      'America/New_York',
      localWeek,
    );

    // 01:00 EST and 03:00 EDT. A class at 02:00 was never offered, so no student can book it,
    // which is the whole reason the grid is generated rather than stored.
    expect(starts).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z']);
  });

  it('handles a zone that shifts by half an hour, and a window that straddles it', () => {
    // Lord Howe springs forward by thirty minutes on 4 October 2026: 02:00 is skipped and 02:30
    // is the first minute of the new offset.
    const localWeek = {
      from: new Date('2026-09-27T13:30:00.000Z'), // Monday 28 Sep, 00:00 at +10:30
      to: new Date('2026-10-04T13:00:00.000Z'), //  Monday 05 Oct, 00:00 at +11:00
    };
    const slots = expandWindows(
      [window({ weekday: 7, startMinutes: 90, endMinutes: 180, slotMinutes: 30 })],
      'Australia/Lord_Howe',
      localWeek,
    );

    // 01:30 at +10:30 and 02:30 at +11:00 — thirty real minutes apart, meeting exactly, because
    // the tiles are cut from the wall clock and the missing one is simply absent.
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-10-03T15:00:00.000Z',
      '2026-10-03T15:30:00.000Z',
    ]);
  });

  it('gives one instant, and only one, to a wall clock that happens twice', () => {
    // Lord Howe falls back on 5 April 2026, so 01:00 and 01:30 arrive twice. A calendar offering
    // a repeated minute twice would let one student hold two claims for one class time; one
    // instant each, chosen deterministically, is the honest answer.
    const localWeek = {
      from: new Date('2026-03-29T13:00:00.000Z'), // Monday 30 Mar, 00:00 at +11:00
      to: new Date('2026-04-05T13:30:00.000Z'), //  Monday 06 Apr, 00:00 at +10:30
    };
    const starts = startsOf(
      [window({ weekday: 7, startMinutes: 60, endMinutes: 150, slotMinutes: 30 })],
      'Australia/Lord_Howe',
      localWeek,
    );

    expect(starts).toHaveLength(3);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('offers what lies in the horizon and nothing outside it', () => {
    const daily = Array.from({ length: SLOT_DAYS_PER_WEEK }, (_, index) =>
      window({ weekday: index + 1, startMinutes: 60, endMinutes: 120, slotMinutes: 60 }),
    );
    const from = new Date('2026-10-05T00:00:00.000Z');
    const horizon = {
      from,
      to: new Date(from.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000),
    };

    const slots = expandWindows(daily, 'Asia/Kolkata', horizon);

    // One class a day, so the count is the number of days offered and every instant is inside the
    // range asked for. A horizon is not a promise about how far ahead a teacher stays open — it is
    // how far the platform is willing to look.
    expect(slots).toHaveLength(BOOKING_HORIZON_DAYS);
    expect(slots.every((slot) => slot.startsAt >= from && slot.startsAt < horizon.to)).toBe(true);
    expect(slots.map((slot) => slot.startsAt.getTime())).toEqual(
      [...slots]
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((slot) => slot.startsAt.getTime()),
    );

    // And the day the horizon opens is not a free half-day: the range starts at 00:00 UTC, which
    // is 05:30 in Kolkata, so that local date's 01:00–02:00 window had already closed and the
    // first offer is the next local day's class.
    expect(slotAt(slots, 0).startsAt.toISOString()).toBe('2026-10-05T19:30:00.000Z');
  });

  it('refuses to invent a class a window cannot hold', () => {
    // The table records what a teacher asked for and the endpoint refuses nonsense (4b), so a
    // generator that trusted its rows would be one bad insert away from an infinite loop or a
    // calendar of zero-minute classes.
    expect(
      startsOf([window({ startMinutes: 600, endMinutes: 540 })], 'Asia/Kolkata', WEEK),
    ).toEqual([]);
    expect(
      startsOf([window({ startMinutes: 600, endMinutes: 600 })], 'Asia/Kolkata', WEEK),
    ).toEqual([]);
    expect(
      startsOf(
        [window({ startMinutes: 540, endMinutes: 570, slotMinutes: 60 })],
        'Asia/Kolkata',
        WEEK,
      ),
    ).toEqual([]);
    expect(startsOf([window({ slotMinutes: 0 })], 'Asia/Kolkata', WEEK)).toEqual([]);
    expect(startsOf([window({ slotMinutes: -30 })], 'Asia/Kolkata', WEEK)).toEqual([]);
  });

  it('asks the same arithmetic whether an instant was ever on the grid', () => {
    // A booking endpoint cannot accept an instant just because a student typed it: the minute has
    // to be one the teacher's windows open. Going through the expansion rather than a second copy
    // of the tiling is what keeps "offered" and "bookable" from ever disagreeing.
    const windows = [window()];
    const monday = expandWindows(windows, 'Asia/Kolkata', WEEK);
    const firstClass = slotAt(monday, 0);

    expect(isWindowStart(windows, 'Asia/Kolkata', firstClass.startsAt)).toBe(true);
    // Mid-class is not a start.
    expect(
      isWindowStart(windows, 'Asia/Kolkata', new Date(firstClass.startsAt.getTime() + 15 * 60_000)),
    ).toBe(false);
    // Tuesday 10:00 in the same shape is a start of a *Tuesday* window, and there is none.
    expect(isWindowStart(windows, 'Asia/Kolkata', new Date('2026-10-06T04:00:00.000Z'))).toBe(
      false,
    );
    expect(isWindowStart([], 'Asia/Kolkata', firstClass.startsAt)).toBe(false);
  });

  it('sorts two windows of one day into one calendar', () => {
    const slots = expandWindows(
      [
        window({ startMinutes: 600, endMinutes: 660, slotMinutes: 30 }),
        window({ startMinutes: 660, endMinutes: 720, slotMinutes: 30 }),
      ],
      'Asia/Kolkata',
      WEEK,
    );

    expect(slots.map((slot) => formatInZone(slot.startsAt, 'Asia/Kolkata').time)).toEqual([
      '10:00 am',
      '10:30 am',
      '11:00 am',
      '11:30 am',
    ]);
  });

  it('keeps a request on the calendar for the hours a teacher can reasonably be asked to answer', () => {
    // The sweep's clock and the horizon are the two numbers a teacher would ask about, so they are
    // named rather than written inline.
    expect(PENDING_REQUEST_HOURS).toBe(24);
    expect(BOOKING_HORIZON_DAYS).toBe(30);
  });
});
