/**
 * The weekly availability contract: the windows a teacher keeps open for classes, written once
 * so the API that decides them and the calendar that draws them cannot disagree about what a
 * Monday at 09:00 is.
 *
 * Everything here is wall-clock. A rule says `minute 540 to minute 630 on the first day of the
 * week`, which is 09:00–10:30 in Kolkata and a different class entirely in Lisbon — and both
 * teachers are right, because the zone lives on the account (§5) and not on the window. Nothing
 * in this file converts, and nothing in it should.
 */

/** The seven days, numbered the way the table stores them: Monday is 1. */
export const MIN_WEEKDAY = 1;
export const MAX_WEEKDAY = 7;

export const WEEKDAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const MINUTES_IN_DAY = 24 * 60;

/** A window may open any minute up to but not including midnight, and must close by midnight at
 * the latest — so an ending at 1440 is 00:00 the next day, which is the last hour a teacher
 * teaching through the night will ask for. */
export const MIN_START_MINUTES = 0;
export const MAX_START_MINUTES = MINUTES_IN_DAY - 1;
export const MIN_END_MINUTES = 1;
export const MAX_END_MINUTES = MINUTES_IN_DAY;

/** A class short enough to be a lesson and long enough to be worth travelling for. Both bounds
 * are a form's business as much as a service's, which is why they live here rather than in the
 * request DTO a portal cannot import. */
export const MIN_SLOT_MINUTES = 5;
export const MAX_SLOT_MINUTES = 240;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday - MIN_WEEKDAY] ?? `Day ${weekday}`;
}

/** Minutes from local midnight as a clock face: `540` reads `09:00`, and `1440` reads `24:00` —
 * the midnight a window that runs through the night closes at. This is printing, not arithmetic:
 * the minutes stay the stored truth and every calculation is done on them. */
export function wallClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export interface AvailabilityRule {
  id: string;
  weekday: number;
  /** Minutes from local midnight, matching the columns. A portal that wants `09:00` renders it
   * from the number the way it renders ₹1,000 from paise — printing is not arithmetic. */
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityRuleResponse {
  rule: AvailabilityRule;
}

/** A week, in the order a teacher reads one: by day, then by the minute each window opens. There
 * is no page because a week has seven days in it, and a control that never appears on a list
 * that cannot grow past a screen is a component nobody maintains. */
export interface AvailabilityRuleListResponse {
  items: AvailabilityRule[];
}

/** What the form sends. Retirement is not in here: a window leaves through its own endpoint or
 * not at all, because an edit that could clear a flag would be a way to close a window while
 * pretending to move it. */
export interface AvailabilityRuleInput {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
}
