import { describe, expect, it } from 'vitest';

import type { ScheduledClass, TeachingClassesResponse } from '@lms/shared';

import { buildTeachingWeeks } from './teaching-week';

/**
 * The arithmetic behind the teacher's dated calendar: the rows the sweep wrote, cut into weeks of
 * seven columns. Nothing here fetches or clicks — the two questions that break a calendar are
 * "which column is this class in" and "how many weeks does the horizon run to", and both are
 * answered in the teacher's zone rather than by accident.
 */

const ZONE = 'Asia/Kolkata';

/** Monday 28 September 2026, 08:30 in Kolkata, plus a rolling month on the same clock face. */
const FROM = '2026-09-28T03:00:00.000Z';
const TO = '2026-10-28T03:00:00.000Z';

/** The instant the read landed: Monday morning, before the first class of the week. */
const NOW = Date.parse(FROM);

function scheduled(overrides: Partial<ScheduledClass> = {}): ScheduledClass {
  return {
    id: 'o1',
    seriesId: 's1',
    course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
    startsAt: '2026-09-28T04:00:00.000Z',
    endsAt: '2026-09-28T04:45:00.000Z',
    durationMinutes: 45,
    studentsExpected: 6,
    ...overrides,
  };
}

function response(items: ScheduledClass[]): TeachingClassesResponse {
  return { from: FROM, to: TO, items };
}

/** Every column across every week, in the order a teacher scrolls them. */
const columns = (weeks: ReturnType<typeof buildTeachingWeeks>) =>
  weeks.flatMap((week) => week.days);

function column(weeks: ReturnType<typeof buildTeachingWeeks>, key: string) {
  const found = columns(weeks).find((day) => day.key === key);
  if (!found) throw new Error(`no column for ${key}`);
  return found;
}

describe('buildTeachingWeeks', () => {
  it('cuts the horizon into whole weeks starting on the Monday it opened inside', () => {
    const weeks = buildTeachingWeeks(response([]), ZONE, NOW);

    // Twenty-eight September is a Monday and the horizon is thirty days, so the last week is a
    // stub that the grid marks rather than invents.
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.label).toBe('Week of 28 Sept');
    expect(weeks[0]?.days.map((day) => day.key)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('marks the days the calendar does not reach, and leaves the rest alone', () => {
    const weeks = buildTeachingWeeks(response([]), ZONE, NOW);
    const last = weeks[4];

    // The horizon ends on Wednesday 28 September's-plus-a-month, so Thursday is the first day no
    // class can stand in. A column drawn as an ordinary empty day would promise a week that ends
    // in nothing.
    expect(last?.days.map((day) => day.state)).toEqual([
      'default',
      'default',
      'default',
      'outside',
      'outside',
      'outside',
      'outside',
    ]);
    expect(last?.days[5]?.empty).toBeUndefined();
  });

  it('puts a class on the day the teacher’s clock says, not the day the row was filed on', () => {
    // 19:00 UTC on Sunday the fourth is 00:30 on Monday the fifth in Kolkata. A grid that grouped
    // by the stored date would teach this class on a Sunday that the teacher marked off.
    const weeks = buildTeachingWeeks(
      response([scheduled({ startsAt: '2026-10-04T19:00:00.000Z' })]),
      ZONE,
      NOW,
    );

    expect(column(weeks, '2026-10-05').chips).toHaveLength(1);
    expect(column(weeks, '2026-10-04').chips ?? []).toHaveLength(0);
  });

  it('writes each chip in the window’s own clock face, down the column in time order', () => {
    const weeks = buildTeachingWeeks(
      response([
        scheduled({
          id: 'o2',
          startsAt: '2026-09-28T09:00:00.000Z',
          endsAt: '2026-09-28T10:00:00.000Z',
          durationMinutes: 60,
        }),
        scheduled({ id: 'o1' }),
      ]),
      ZONE,
      NOW,
    );

    expect(column(weeks, '2026-09-28').chips?.map((chip) => chip.label)).toEqual([
      '09:30–10:15',
      '14:30–15:30',
    ]);
  });

  it('leaves a dated class nothing to press', () => {
    // The series owns this row and the sweep wrote it; there is no route a press could send, and a
    // chip that looked like a button would be a control the platform refuses.
    const weeks = buildTeachingWeeks(response([scheduled()]), ZONE, NOW);
    const chip = column(weeks, '2026-09-28').chips?.[0];

    expect(chip?.onSelect).toBeUndefined();
    expect(chip?.tone).toBe('confirmed');
  });

  it('names a class out loud with the course and the roll beside it', () => {
    const weeks = buildTeachingWeeks(response([scheduled()]), ZONE, NOW);

    expect(column(weeks, '2026-09-28').chips?.[0]?.ariaLabel).toBe(
      'Monday 28 Sept, 09:30 to 10:15 · Veena Basics, 6 students',
    );
  });

  it('says which column the teacher is standing in', () => {
    const weeks = buildTeachingWeeks(response([]), ZONE, NOW);

    expect(column(weeks, '2026-09-28').state).toBe('today');
    expect(column(weeks, '2026-09-29').state).toBe('default');
  });

  it('explains an empty day inside the horizon', () => {
    const weeks = buildTeachingWeeks(response([]), ZONE, NOW);

    expect(column(weeks, '2026-09-29').empty).toBe('No class');
  });

  it('keeps one week’s classes together, soonest first, beside the columns that hold them', () => {
    const weeks = buildTeachingWeeks(
      response([
        scheduled({ id: 'far', startsAt: '2026-10-19T04:00:00.000Z' }),
        scheduled({ id: 'late', startsAt: '2026-09-29T04:00:00.000Z' }),
        scheduled({ id: 'early' }),
      ]),
      ZONE,
      NOW,
    );

    expect(weeks[0]?.classes.map((row) => row.id)).toEqual(['early', 'late']);
    expect(weeks[3]?.classes.map((row) => row.id)).toEqual(['far']);
  });

  it('draws a week with nothing in it rather than dropping it', () => {
    // A teacher between two terms reads a run of empty weeks as the state of their calendar, and a
    // grid that skipped them would make the next week look like this one.
    const weeks = buildTeachingWeeks(response([]), ZONE, NOW);

    expect(weeks[1]?.days).toHaveLength(7);
    expect(weeks[1]?.classes).toEqual([]);
  });
});
