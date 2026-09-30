/**
 * The recurring calendar contract: series of classes that repeat weekly, and the holidays
 * that stop minutes from being offered at all.
 *
 * A series is a teacher's plan for one course — Monday at 09:00–10:00, Thursday at 14:00–15:00 —
 * and the booking endpoint auto-enrolls students into every instance that falls within their
 * enrollment window. A holiday is a day the teacher does not teach: a public holiday, a personal
 * day off, or a festival. Both are edits to what §13's windows mean, so they come after booking
 * has settled.
 */

/** The seven days, numbered the way the table stores them: Monday is 1. Re-exported here so
 * the calendar code does not reach into availability.ts for a constant it already knows. */
export { MIN_WEEKDAY, MAX_WEEKDAY, WEEKDAY_LABELS, weekdayLabel } from './availability';

/**
 * One slot in a course's weekly schedule.
 *
 * `durationMinutes` is stored separately from `endMinutes - startMinutes` because a teacher may
 * want a 60-minute window with 45-minute classes and 15-minute breaks between them. The series
 * says how long each class inside the window lasts; the window itself is the container.
 */
export interface ClassSeries {
  id: string;
  courseId: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  isActive: boolean;
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

/**
 * A day this teacher does not teach.
 *
 * Stored as an ISO 8601 date string (`YYYY-MM-DD`) rather than a timestamp, because the whole
 * day is blocked and the zone decides when midnight is. Recurring annually means this date is
 * blocked every year (Diwali, Christmas), while a one-off blocks only the stated year.
 */
export interface Holiday {
  id: string;
  teacherUserId: string;
  /** ISO 8601 date: `2026-12-25`. Validated by the endpoint to match `/^\d{4}-\d{2}-\d{2}$/`. */
  date: string;
  reason: string | null;
  isRecurringAnnual: boolean;
  isActive: boolean;
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
