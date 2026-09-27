import { MAX_END_MINUTES, MAX_START_MINUTES, MINUTES_IN_DAY, MIN_WEEKDAY } from './availability';
import {
  getZoneParts,
  instantAtLocalMinutes,
  zoneDateOf,
  type LocalDate,
} from './timezone';

/**
 * The one place a teacher's weekly windows become the instants a student is offered.
 *
 * The grid is generated on every read and never stored, which is what makes the awkward days of
 * a timezone a solved problem instead of a bug report: a window is a rule about a wall clock
 * ("Monday, 09:00 until 10:30, half-hour classes"), and only this arithmetic decides that on the
 * Sunday the spring-forward takes, no 02:00 class exists to offer — so no student can book one,
 * and nothing has to be repaired in a table afterwards.
 *
 * The same function answers "what is on the calendar" and "may this instant be booked" (see
 * `slotAt`), because those two questions must never have different answers.
 */

/** A window exactly as the rule stores it: a weekday and a stretch of local minutes. */
export interface WeeklyWindow {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
}

/** One class a student could take. `endsAt` is real elapsed time, so a class that starts on the
 * far side of a shifted clock still runs for the length the teacher asked for. */
export interface SlotInstant {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotHorizon {
  from: Date;
  to: Date;
}

export const SLOT_DAYS_PER_WEEK = 7;

/** How far ahead the platform is willing to look for open classes. Not a promise that a teacher
 * stays open that long — a student simply is not shown a class a month out. */
export const BOOKING_HORIZON_DAYS = 30;

/** How long a request waits for the teacher's answer before it stops holding the minute. Named
 * here because the sweep that expires it and the screen that warns the student read one number. */
export const PENDING_REQUEST_HOURS = 24;

/** How early a live class can be joined, and how long after its stated end the door stays open.
 * Both are here rather than in the booking endpoint because the API that refuses a too-early
 * arrival and the portal that says "opens at 09:25" answer to one pair of numbers. */
export const LIVE_CLASS_DOOR_OPENS_MINUTES_BEFORE = 5;
export const LIVE_CLASS_DOOR_STAYS_MINUTES_AFTER = 15;

/** The span a booked class may be entered: from just before its first minute to a grace period
 * after its last. Measured on the two instants the row already holds, so a class that crosses a
 * clock change is still timed by its own ends. */
export interface LiveClassWindow {
  opensAt: Date;
  closesAt: Date;
}

export function liveClassWindow(startsAt: Date, endsAt: Date): LiveClassWindow {
  return {
    opensAt: new Date(startsAt.getTime() - LIVE_CLASS_DOOR_OPENS_MINUTES_BEFORE * MS_PER_MINUTE),
    closesAt: new Date(endsAt.getTime() + LIVE_CLASS_DOOR_STAYS_MINUTES_AFTER * MS_PER_MINUTE),
  };
}

const MS_PER_DAY = 24 * 60 * 60_000;
const MS_PER_MINUTE = 60_000;

/**
 * A calendar date stepped by days, so a DST shift can never shorten or lengthen the walk.
 *
 * Exported because a screen that pages a week needs the same walk the generator does: seven
 * twenty-four-hour slices across the spring-forward weekend land on six columns and skip one.
 */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * MS_PER_DAY);
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

function serialOf(date: LocalDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/** Monday is 1, the way the availability table stores it. */
export function isoWeekdayOf(date: LocalDate): number {
  const sundayFirst = new Date(serialOf(date)).getUTCDay();
  return ((sundayFirst + 6) % SLOT_DAYS_PER_WEEK) + MIN_WEEKDAY;
}

/**
 * The window's own start-of-class minutes, cut from the wall clock.
 *
 * A class must finish inside the window: a teacher who wrote "open until 10:30" is offering
 * lessons that end by 10:30, not one that runs into 11:00. Nonsense rows are refused here rather
 * than looped over — the endpoint already rejects them (4b), and a generator that trusted its
 * input would be one bad insert away from never finishing.
 */
function tileMinutes(window: WeeklyWindow): number[] {
  const { startMinutes, slotMinutes } = window;
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) return [];
  if (!Number.isInteger(startMinutes) || startMinutes < 0 || startMinutes > MAX_START_MINUTES) {
    return [];
  }
  const endMinutes = Math.min(window.endMinutes, MAX_END_MINUTES);
  if (!Number.isInteger(endMinutes) || endMinutes <= startMinutes) return [];

  const minutes: number[] = [];
  for (let at = startMinutes; at + slotMinutes <= endMinutes; at += slotMinutes) {
    minutes.push(at);
  }
  return minutes;
}

/**
 * The instant for one tile, but only if the zone's clock actually reads that face on that date.
 * A skipped minute (spring forward) resolves to a neighbouring one and is dropped here; a
 * repeated minute (fall back) resolves through `instantAtLocalMinutes` to whichever pass the
 * offset leads to, so it is offered exactly once.
 */
function resolveTile(timeZone: string, date: LocalDate, minutes: number): Date | null {
  if (minutes >= MINUTES_IN_DAY) return null;
  const instant = instantAtLocalMinutes(timeZone, date, minutes);
  const parts = getZoneParts(instant, timeZone);
  const reads = parts.hour * 60 + parts.minute;
  if (parts.year !== date.year || parts.month !== date.month || parts.day !== date.day) return null;
  return reads === minutes ? instant : null;
}

/**
 * Every class the given windows open inside `horizon`, oldest first and with no repeats.
 *
 * A tile is in the horizon when its *instant* is, so a range that begins mid-day simply starts
 * mid-week: the local morning that had already gone by is not offered again.
 */
export function expandWindows(
  windows: WeeklyWindow[],
  timeZone: string,
  horizon: SlotHorizon,
): SlotInstant[] {
  if (windows.length === 0 || horizon.from >= horizon.to) return [];

  const byWeekday = new Map<number, WeeklyWindow[]>();
  for (const window of windows) {
    if (!Number.isInteger(window.weekday)) continue;
    const list = byWeekday.get(window.weekday);
    if (list) list.push(window);
    else byWeekday.set(window.weekday, [window]);
  }

  const slots = new Map<number, SlotInstant>();
  const lastDate = zoneDateOf(horizon.to, timeZone);
  for (let date = zoneDateOf(horizon.from, timeZone); serialOf(date) <= serialOf(lastDate);) {
    for (const window of byWeekday.get(isoWeekdayOf(date)) ?? []) {
      for (const minutes of tileMinutes(window)) {
        const startsAt = resolveTile(timeZone, date, minutes);
        if (!startsAt || startsAt < horizon.from || startsAt >= horizon.to) continue;
        slots.set(startsAt.getTime(), {
          startsAt,
          endsAt: new Date(startsAt.getTime() + window.slotMinutes * MS_PER_MINUTE),
        });
      }
    }
    date = addLocalDays(date, 1);
  }

  return [...slots.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * The class a teacher's windows open at exactly this instant, or nothing.
 *
 * Asked of the expansion itself rather than a second copy of the tiling, so "offered" and
 * "bookable" cannot drift apart: a booking endpoint gets back the same `SlotInstant` the calendar
 * showed, including the length the window said the class was.
 *
 * The horizon is deliberately two days wide on each side: every tile belongs to the local date
 * the instant itself is read in, and a zone's day is at most twenty-five real hours long, so a
 * range that wide cannot miss the minute being asked about. Seconds are not on any grid.
 */
export function slotAt(
  windows: WeeklyWindow[],
  timeZone: string,
  instant: Date,
): SlotInstant | null {
  if (getZoneParts(instant, timeZone).second !== 0) return null;
  const around = {
    from: new Date(instant.getTime() - 2 * MS_PER_DAY),
    to: new Date(instant.getTime() + 2 * MS_PER_DAY),
  };
  return (
    expandWindows(windows, timeZone, around).find(
      (slot) => slot.startsAt.getTime() === instant.getTime(),
    ) ?? null
  );
}
