import {
  addLocalDays,
  formatInZone,
  getZoneParts,
  instantAtLocalMinutes,
  isoWeekdayOf,
  localDateKey,
  wallClock,
  weekdayLabel,
  zoneDateKey,
  zoneDateOf,
  type LocalDate,
  type ScheduledClass,
  type TeachingClassesResponse,
} from '@lms/shared';
import type { CalendarChip, CalendarDay } from '@lms/ui';

/**
 * The teacher's dated calendar: the rows the sweep wrote, cut into weeks of seven columns.
 *
 * This lives apart from the screen because a calendar has two ways to be quietly wrong and both are
 * arithmetic. A class at 19:00 UTC is Monday morning in Kolkata and Sunday evening in London, so a
 * column's day comes from the *teacher's* zone — the zone the series was written in and the zone the
 * sweep expanded it in — and nothing else; and the horizon the platform stands behind is thirty days
 * rather than five whole weeks, so the last week is marked rather than invented. Both mistakes draw
 * a working-looking grid, and both cost a teacher the class they thought they had on Tuesday.
 *
 * The `now` a caller passes is the instant its read settled, not a clock read here: a grid whose
 * "today" moves between the server's pass and the browser's is a hydration mismatch with a friendly
 * face.
 */

const NOON = 12 * 60;

export interface TeachingWeek {
  /** Names the grid to a keyboard user: `Week of 28 Sept`. */
  label: string;
  days: CalendarDay[];
  /** This week's classes, soonest first — the list beside the grid, for the rows a column of clock
   * faces cannot hold: which course it is, and how many people are standing for it. */
  classes: ScheduledClass[];
}

/** The Monday a date is inside, so the first column is where a week starts rather than where the
 * horizon happened to open. */
function mondayOf(date: LocalDate): LocalDate {
  return addLocalDays(date, -(isoWeekdayOf(date) - 1));
}

/** A clock face in the zone the grid is read in. */
function face(instant: Date | string, timeZone: string): string {
  const { hour, minute } = getZoneParts(instant, timeZone);
  return wallClock(hour * 60 + minute);
}

/** The day a date is on, as a column header reads it: `28 Sept`. */
function dateLabel(date: LocalDate, timeZone: string): string {
  const { dayOfMonth, month } = formatInZone(instantAtLocalMinutes(timeZone, date, NOON), timeZone);
  return `${dayOfMonth} ${month}`;
}

function roll(count: number): string {
  return `${count} ${count === 1 ? 'student' : 'students'}`;
}

/**
 * One class as a chip.
 *
 * Deliberately without an `onSelect`: a dated class is reported rather than acted on, and the
 * primitive draws a handler-less chip as static text so that nothing on this grid looks pressable.
 * The time goes on the face of the chip because that is what a column holds; the course and the roll
 * go into the words a screen reader hears, and into the list under the grid.
 */
function chip(row: ScheduledClass, date: LocalDate, timeZone: string): CalendarChip {
  const starts = face(row.startsAt, timeZone);
  const ends = face(row.endsAt, timeZone);
  return {
    id: row.id,
    label: `${starts}–${ends}`,
    tone: 'confirmed',
    ariaLabel: `${weekdayLabel(isoWeekdayOf(date))} ${dateLabel(date, timeZone)}, ${starts} to ${ends} · ${row.course.title}, ${roll(row.studentsExpected)}`,
  };
}

/** Classes collected by the column they belong to, each in time order. */
function byDayOf(items: ScheduledClass[], timeZone: string): Map<string, ScheduledClass[]> {
  const byDay = new Map<string, ScheduledClass[]>();
  for (const row of items) {
    const key = zoneDateKey(row.startsAt, timeZone);
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }
  return byDay;
}

export function buildTeachingWeeks(
  response: TeachingClassesResponse,
  timeZone: string,
  now: number,
): TeachingWeek[] {
  const firstDate = zoneDateOf(response.from, timeZone);
  // The horizon's end is exclusive, so the last day a class can start on is the instant before it.
  const lastDate = zoneDateOf(new Date(Date.parse(response.to) - 1), timeZone);
  const firstKey = localDateKey(firstDate);
  const lastKey = localDateKey(lastDate);
  const todayKey = zoneDateKey(new Date(now), timeZone);
  const dated = byDayOf(response.items, timeZone);

  const weeks: TeachingWeek[] = [];
  for (
    let monday = mondayOf(firstDate);
    localDateKey(monday) <= lastKey;
    monday = addLocalDays(monday, 7)
  ) {
    const days: CalendarDay[] = [];
    const classes: ScheduledClass[] = [];

    for (let index = 0; index < 7; index += 1) {
      const date = addLocalDays(monday, index);
      const key = localDateKey(date);
      const outside = key < firstKey || key > lastKey;
      const onDay = dated.get(key) ?? [];
      classes.push(...onDay);

      days.push({
        key,
        weekday: weekdayLabel(isoWeekdayOf(date)).slice(0, 3),
        date: dateLabel(date, timeZone),
        state: outside ? 'outside' : key === todayKey ? 'today' : 'default',
        chips: onDay.map((row) => chip(row, date, timeZone)),
        // A day the calendar reaches and holds nothing on is an answer; a day past its end is not
        // a day at all, and explaining it would be explaining a date no class can stand in.
        ...(!outside && onDay.length === 0 ? { empty: 'No class' } : {}),
      });
    }

    weeks.push({ label: `Week of ${dateLabel(monday, timeZone)}`, days, classes });
  }

  return weeks;
}
