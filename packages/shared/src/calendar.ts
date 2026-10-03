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
import { ATTENDANCE_STATUS_CODES, type AttendanceStatusCode } from './lookup-codes';
import type { RosterStudent } from './enrollments';
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

/**
 * How far forward a teacher's series is written down as dated classes.
 *
 * Thirty days, the same span a student is allowed to book into, so a term and a booking calendar
 * end on the same day and nobody has to explain why one of them stops earlier. It is a horizon of
 * *rows* rather than of *offers*: `BOOKING_HORIZON_DAYS` bounds a grid derived fresh on every page
 * load, while this bounds a table the sweep has to keep, and a pattern that ran past the last row
 * would show a calendar with a hole in the middle of it.
 */
export const OCCURRENCE_HORIZON_DAYS = 30;

/**
 * One dated class, as the teacher who teaches it reads it.
 *
 * `endsAt` is not stored — the row keeps a start and a length — for the same reason a booking
 * carries one: a calendar square has to say when the class is over, and three portals each adding
 * sixty minutes is how one class ends at three times.
 *
 * `studentsExpected` counts the names on the register beside the class, which is what tells a
 * teacher whether Monday is a lesson or a room full of people. It is a number rather than a list
 * because a week of classes is a list of days, and the names are a screen away — the roster a
 * teacher marks after the class is Stage 3's question, asked of one class at a time.
 */
export interface ScheduledClass {
  id: string;
  /** The pattern this class came from, so a screen can say "the Monday nine o'clock" as well as a
   * date. */
  seriesId: string;
  course: { id: string; slug: string; title: string };
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  studentsExpected: number;
}

/**
 * The teacher's dated classes, oldest first, within the window they asked for.
 *
 * `from` and `to` are echoed back because they are the caller's, not the platform's: the rows only
 * exist as far as the horizon, and a screen that asked for April and got March needs to know which
 * of the two it ran out of.
 */
export interface TeachingClassesResponse {
  from: string;
  to: string;
  items: ScheduledClass[];
}

/**
 * One dated class a student is standing for.
 *
 * There is no register count here and no series id: a student's calendar is a list of days they are
 * expected at, and both of those facts belong to whoever runs the course.
 *
 * `status` is the student's own mark — present or absent — or null while the class has not been
 * answered. A mark can only be made after the minute has passed, so a future class on this list is
 * unmarked by definition, and the null is the honest state rather than a placeholder for one.
 */
export interface AssignedClass {
  id: string;
  course: { id: string; slug: string; title: string };
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: AttendanceStatusCode | null;
}

/** The classes a student holds a place in, oldest first, within the window they asked for. */
export interface LearningClassesResponse {
  from: string;
  to: string;
  items: AssignedClass[];
}

/**
 * What a teacher said about one name on one class's register.
 *
 * Two words, because two answers exist. The third state a line can be in — nobody has marked it —
 * is carried by `null` on the line rather than by a code, and a label for it would put a word on
 * the absence of one.
 */
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatusCode, string> = {
  [ATTENDANCE_STATUS_CODES.PRESENT]: 'Present',
  [ATTENDANCE_STATUS_CODES.ABSENT]: 'Absent',
};

/**
 * One name a dated class is standing for, and the mark on it.
 *
 * The student is a `RosterStudent` — an id and a name, no address — for the same reason the course
 * roster withholds one: this screen answers who was expected, and an email is the field a list
 * like this picks up by convenience and never puts down.
 *
 * `id` is the register line's own key, which a screen never sends back. A teacher marks a *person*,
 * so the save names students; the row is found from the pair (this class, that person) once the
 * route has established that the class is the caller's to mark.
 */
export interface RollLine {
  id: string;
  student: RosterStudent;
  status: AttendanceStatusCode | null;
}

/**
 * One class's register: the names it stands for, and whether a mark may be written right now.
 *
 * `canMark` is the server's fact rather than a client comparing `startsAt` against its own clock,
 * because the two would disagree by whatever the visitor's device is off, and the disagreement
 * would be a save button on a class that has not happened yet. It stays true forever after the
 * class starts: a register the teacher forgot to fill in on Monday is a register they can still
 * fill in on Thursday, and nothing in the platform should get harder to do with age.
 *
 * The lines are the names on the sheet — the ones the sweep keeps in step with the course's open
 * places. A student who has left is not on it: the row stays in the table with its mark, because
 * "who was meant to be there" is a fact about that day, but a screen that offered a mark for a
 * person who no longer holds a place would be asking a question the class no longer has.
 */
export interface ClassRoll {
  classId: string;
  course: { id: string; slug: string; title: string };
  startsAt: string;
  endsAt: string;
  canMark: boolean;
  lines: RollLine[];
}

/**
 * The marks a teacher is making on one class — a whole roll, saved at once.
 *
 * A list rather than a single line because that is the act: somebody goes down the names after the
 * lesson and puts the answer in. `null` on a line clears the mark, which is a correction and not a
 * non-answer — a line marked absent by mistake goes back to unmarked, not to a word nobody gave.
 */
export interface SaveRollInput {
  lines: Array<{ studentId: string; status: AttendanceStatusCode | null }>;
}
