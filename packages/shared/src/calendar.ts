/**
 * The recurring calendar contract: series of classes that repeat weekly, and the holidays
 * that stop a day from teaching at all.
 *
 * A series is a teacher's plan for one course — Monday at 09:00–11:00, Thursday at 14:00–15:00 —
 * and a holiday is a day the teacher does not teach: a public holiday, a personal day off, or a
 * festival. Neither is a class. Both are inputs to the arithmetic at the bottom of this file,
 * which is the only place a pattern becomes the dated instances a cohort is enrolled in, so the
 * sweep that fills a calendar and the screen that reads one cannot answer differently.
 */

import { expandWindows, type SlotHorizon, type SlotInstant, type WeeklyWindow } from './schedule';
import { zoneDateKey } from './timezone';

/** The seven days, numbered the way the table stores them: Monday is 1. Re-exported here so
 * the calendar code does not reach into availability.ts for a constant it already knows. */
export { MIN_WEEKDAY, MAX_WEEKDAY, WEEKDAY_LABELS, weekdayLabel } from './availability';

/**
 * What a generator needs from a series and nothing more: one week's pattern in wall-clock minutes.
 *
 * Its own type rather than `ClassSeries` because the row the API reads and the row a test writes
 * are both enough here, and a function that asks only for the pattern cannot quietly start
 * depending on an id.
 */
export interface SeriesPattern {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  /** How long each class inside the window runs, which is what the window is tiled with. */
  durationMinutes: number;
  /** A retired pattern opens no classes. Nothing is deleted, so this is the only way a row can
   * stop meaning anything. */
  isActive: boolean;
}

/**
 * One slot in a course's weekly schedule.
 *
 * `durationMinutes` is stored separately from `endMinutes - startMinutes` because a teacher may
 * want a 60-minute window with 45-minute classes and 15-minute breaks between them. The series
 * says how long each class inside the window lasts; the window itself is the container.
 */
export interface ClassSeries extends SeriesPattern {
  id: string;
  courseId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassSeriesResponse {
  series: ClassSeries;
}

/** What the form sends. Retirement is not in here: a series leaves through its own endpoint or
 * not at all, because an edit that could clear a flag would be a way to close a series while
 * pretending to move it. */
export interface ClassSeriesInput {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
}

/** A week's worth of series for one course, in the order a teacher reads them: by day, then by
 * the minute each series opens. */
export interface ClassSeriesListResponse {
  items: ClassSeries[];
}

/** What a blocker needs from a holiday: the day it names and how long it lasts for. */
export interface HolidayPattern {
  /** ISO 8601 date: `2026-12-25`. */
  date: string;
  /** Whether the date repeats: Diwali every year, a funeral once. */
  isRecurringAnnual: boolean;
  isActive: boolean;
}

/**
 * A day this teacher does not teach.
 *
 * Stored as an ISO 8601 date string (`YYYY-MM-DD`) rather than a timestamp, because the whole
 * day is blocked and the zone decides when midnight is. Recurring annually means this date is
 * blocked every year (Diwali, Christmas), while a one-off blocks only the stated year.
 */
export interface Holiday extends HolidayPattern {
  id: string;
  teacherUserId: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayResponse {
  holiday: Holiday;
}

/** What the form sends. */
export interface HolidayInput {
  date: string;
  reason?: string;
  isRecurringAnnual?: boolean;
}

/** All holidays for one teacher, sorted by date descending (newest first). */
export interface HolidayListResponse {
  items: Holiday[];
}

/**
 * The series as §13's grid already understands it: the class length becomes the tile.
 *
 * A series and an availability rule are the same shape with one column renamed, and that is why
 * this is a mapping rather than a second generator — the rules about a window (a class has to
 * finish inside it, a nonsense row opens nothing) belong to `expandWindows` and would otherwise
 * have to be written twice and kept in step.
 */
export function seriesWindow(series: SeriesPattern): WeeklyWindow {
  return {
    weekday: series.weekday,
    startMinutes: series.startMinutes,
    endMinutes: series.endMinutes,
    slotMinutes: series.durationMinutes,
  };
}

/** The `-MM-DD` half of a `YYYY-MM-DD` key — the part a yearly holiday repeats on. */
function monthDay(date: string): string {
  return date.slice(5);
}

/**
 * The holiday that closes a local date, or nothing.
 *
 * `localDate` is a `YYYY-MM-DD` key already read in the teacher's zone, which is the whole
 * contract: a holiday names a day on that person's calendar, so it is that day and only that day
 * that closes. An annual holiday matches on the month and day it was stored for, which is how a
 * date written in 2025 still means anything in 2031, and how a one-off still means only the year
 * it was written for.
 */
export function holidayOn(holidays: HolidayPattern[], localDate: string): HolidayPattern | null {
  const repeats = monthDay(localDate);
  for (const holiday of holidays) {
    if (!holiday.isActive) continue;
    if (holiday.date === localDate) return holiday;
    if (holiday.isRecurringAnnual && monthDay(holiday.date) === repeats) return holiday;
  }
  return null;
}

/**
 * Every class one series opens inside `horizon`, oldest first, with the marked-off days gone.
 *
 * Deliberately a single series rather than a list: the sweep that fills a calendar has to know
 * which pattern a dated class came from, and a generator that returned them all mixed together
 * would throw the answer away. `holidays` is the teacher's own list — a blocker belongs to the
 * person who does not teach, not to the course.
 *
 * The holiday test runs on each class's *own* local date rather than the date of the tile it came
 * from, which is the same fact for most of the year and a different one at midnight: a 00:30 class
 * in Kolkata is a 19:00 instant on the day before, and a teacher who marks off Monday has closed
 * that class whether or not the database filed it on Sunday.
 */
export function expandSeries(
  series: SeriesPattern,
  timeZone: string,
  horizon: SlotHorizon,
  holidays: HolidayPattern[] = [],
): SlotInstant[] {
  if (!series.isActive) return [];
  return expandWindows([seriesWindow(series)], timeZone, horizon).filter(
    (slot) => holidayOn(holidays, zoneDateKey(slot.startsAt, timeZone)) === null,
  );
}
