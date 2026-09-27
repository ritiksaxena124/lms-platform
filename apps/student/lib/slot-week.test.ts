import { describe, expect, it } from 'vitest';

import type { Booking, OpenSlotsResponse } from '@lms/shared';

import { buildSlotWeeks } from './slot-week';

/**
 * The arithmetic behind the book-a-class grid: a list of instants the API searched, and seven
 * columns a person can read. Nothing here is about fetching or clicking — the questions that
 * break a calendar are "which column is this class in" and "how many weeks is the month the API
 * looked at", and both are answered in the teacher's zone rather than by accident.
 */

const ZONE = 'Asia/Kolkata';

/** Monday 28 Sept 2026, 00:00 in Kolkata, plus a rolling month. */
const FROM = '2026-09-27T18:30:00.000Z';
const TO = '2026-10-27T18:30:00.000Z';

function slot(startsAt: string, minutes = 45) {
  return {
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
  };
}

function response(
  overrides: Partial<OpenSlotsResponse> = {},
): OpenSlotsResponse {
  return {
    course: { id: 'b2a1', slug: 'fractions', title: 'Fractions', demoBookingsEnabled: true },
    teacher: { id: 't1', timezone: ZONE },
    entitlement: 'enrolled',
    denial: null,
    from: FROM,
    to: TO,
    slots: [],
    ...overrides,
  };
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: '6a27',
    course: { id: 'b2a1', slug: 'fractions', title: 'Fractions' },
    type: 'enrolled',
    status: 'pending',
    startsAt: '2026-09-28T04:00:00.000Z',
    endsAt: '2026-09-28T04:45:00.000Z',
    durationMinutes: 45,
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

/** Every column across every week, in the order a student scrolls them. */
const columns = (weeks: ReturnType<typeof buildSlotWeeks>) => weeks.flatMap((week) => week.days);

describe('buildSlotWeeks', () => {
  it('starts the first week on the Monday the horizon opens in', () => {
    // A Wednesday read still shows the Monday of that week, so the week has its usual shape and
    // the two days before the horizon are marked rather than missing.
    const weeks = buildSlotWeeks(
      response({ from: '2026-09-30T06:00:00.000Z', slots: [] }),
      [],
      Date.parse('2026-09-30T06:00:00.000Z'),
    );

    expect(weeks[0]?.days.map((day) => day.key)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks[0]?.days[0]?.state).toBe('outside');
    // The day the read is happening on, which is the teacher's today rather than the reader's.
    expect(weeks[0]?.days[2]?.state).toBe('today');
    expect(weeks[0]?.days[3]?.state).toBe('default');
  });

  it('covers exactly the days the API searched, and no further', () => {
    const weeks = buildSlotWeeks(response(), [], Date.parse(FROM));
    const last = columns(weeks).at(-1);

    // 28 Sept to 27 Oct in Kolkata is 30 days, which is five whole weeks and five days: the
    // month the API searched ends mid-week, and the rest of that week is marked rather than
    // offered, so a student never sees a Thursday the teacher was never asked about.
    expect(weeks).toHaveLength(5);
    expect(last?.key).toBe('2026-11-01');
    expect(columns(weeks).filter((day) => day.state === 'outside')[0]?.key).toBe('2026-10-28');
    expect(
      columns(weeks)
        .filter((day) => day.state !== 'outside')
        .at(-1)
        ?.key,
    ).toBe('2026-10-27');
  });

  it('names a column the way the teacher reads it', () => {
    const weeks = buildSlotWeeks(response({ slots: [slot('2026-09-28T04:00:00.000Z')] }), [], Date.parse(FROM));
    const monday = weeks[0]?.days[0];

    expect(monday?.weekday).toBe('Mon');
    expect(monday?.date).toBe('28 Sept');
    expect(monday?.chips?.[0]?.label).toBe('09:30–10:15');
    expect(monday?.chips?.[0]?.ariaLabel).toBe('Monday 28 Sept, 09:30 to 10:15');
    expect(weeks[0]?.label).toBe('Week of 28 Sept');
  });

  it('puts a class on the day the teacher is standing in', () => {
    // 19:00 UTC is 00:30 the next morning in Kolkata. Grouped by the stored UTC date this class
    // would appear on Sunday; grouped by the zone it belongs to, it is a Monday class.
    const weeks = buildSlotWeeks(
      response({ slots: [slot('2026-09-27T19:00:00.000Z')] }),
      [],
      Date.parse('2026-09-27T18:30:00.000Z'),
    );
    const monday = weeks[0]?.days[0];

    expect(monday?.key).toBe('2026-09-28');
    expect(monday?.chips?.map((chip) => chip.label)).toEqual(['00:30–01:15']);
  });

  it('leaves a day with nothing on it to explain itself', () => {
    const weeks = buildSlotWeeks(response({ slots: [slot('2026-09-28T04:00:00.000Z')] }), [], Date.parse(FROM));

    expect(weeks[0]?.days[1]?.chips).toEqual([]);
    expect(weeks[0]?.days[1]?.empty).toBe('No classes');
    expect(weeks[0]?.days[0]?.empty).toBeUndefined();
  });

  it('draws a class the student has asked for as theirs, not as an open minute', () => {
    const asked = slot('2026-09-28T04:00:00.000Z');
    const weeks = buildSlotWeeks(
      // The read is a moment old: the minute the student just took is still in the list the
      // server sent. One chip, in the state the booking says it is in.
      response({ slots: [asked] }),
      [booking()],
      Date.parse(FROM),
    );
    const chips = weeks[0]?.days[0]?.chips;

    expect(chips).toHaveLength(1);
    expect(chips?.[0]?.tone).toBe('pending');
    // No handler, so the primitive draws it as text: a minute that is already theirs must not
    // look like a button that does nothing.
    expect(chips?.[0]?.onSelect).toBeUndefined();
  });

  it('keeps a confirmed class on the grid, and a finished one off it', () => {
    const weeks = buildSlotWeeks(
      response(),
      [
        booking({ id: 'a', status: 'confirmed', startsAt: '2026-09-28T04:00:00.000Z' }),
        booking({ id: 'b', status: 'cancelled', startsAt: '2026-09-28T04:45:00.000Z' }),
        booking({ id: 'c', status: 'completed', startsAt: '2026-09-28T05:30:00.000Z' }),
        booking({ id: 'd', status: 'rejected', startsAt: '2026-09-28T06:15:00.000Z' }),
      ],
      Date.parse(FROM),
    );
    const chips = weeks[0]?.days[0]?.chips;

    expect(chips?.map((chip) => chip.tone)).toEqual(['confirmed']);
  });

  it('keeps another course classes off this calendar', () => {
    const weeks = buildSlotWeeks(
      response(),
      [booking({ course: { id: 'other', slug: 'other', title: 'Other' } })],
      Date.parse(FROM),
    );

    expect(columns(weeks).some((day) => (day.chips ?? []).length > 0)).toBe(false);
  });

  it('marks the day the teacher is living through', () => {
    const weeks = buildSlotWeeks(
      response({ from: '2026-09-29T06:00:00.000Z', to: '2026-10-05T06:00:00.000Z' }),
      [],
      Date.parse('2026-10-01T06:00:00.000Z'),
    );

    expect(columns(weeks).find((day) => day.state === 'today')?.key).toBe('2026-10-01');
  });

  it('makes only the open minutes pressable, and the chosen one its own colour', () => {
    const weeks = buildSlotWeeks(
      response({
        slots: [slot('2026-09-28T04:00:00.000Z'), slot('2026-09-28T04:45:00.000Z')],
      }),
      [booking({ startsAt: '2026-09-28T05:30:00.000Z', endsAt: '2026-09-28T06:15:00.000Z' })],
      Date.parse(FROM),
      { selected: '2026-09-28T04:00:00.000Z', onSelect: () => {} },
    );
    const chips = weeks[0]?.days[0]?.chips;

    expect(chips?.map((chip) => chip.tone)).toEqual(['selected', 'available', 'pending']);
    expect(chips?.[0]?.onSelect).toBeTypeOf('function');
    expect(chips?.[1]?.onSelect).toBeTypeOf('function');
    expect(chips?.[2]?.onSelect).toBeUndefined();
  });
});
