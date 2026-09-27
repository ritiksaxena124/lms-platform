'use client';

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Calendar, type CalendarChip, type CalendarDay } from '../components/Calendar';

const MONDAY = '2026-09-28';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OPEN_TIMES = ['09:00', '09:30', '10:00'];

/** The part of a column a chip needs to describe itself: which day it is standing on. */
type Column = Pick<CalendarDay, 'key' | 'weekday' | 'date'>;

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A week of columns drawn from a Monday. The component takes strings rather than instants on
 * purpose — grouping a timestamp into a day belongs to `@lms/shared`, and a story that redid that
 * arithmetic here would be a second place for it to go wrong.
 */
function week(
  monday: string,
  build: (index: number, column: Column) => Partial<CalendarDay>,
): CalendarDay[] {
  const start = Date.parse(`${monday}T00:00:00Z`);

  return WEEKDAYS.map((weekday, index) => {
    const day = new Date(start + index * 86_400_000);
    const month = day.getUTCMonth();
    const date = day.getUTCDate();

    const column: Column = {
      key: `${day.getUTCFullYear()}-${pad(month + 1)}-${pad(date)}`,
      weekday,
      date: `${date} ${MONTHS[month]}`,
    };

    return { ...column, ...build(index, column) };
  });
}

/**
 * Without a handler the chips are a schedule as reported; with one they are minutes to take, and a
 * takeable minute says which day it belongs to — four columns of `Book 09:00` are one sentence
 * repeated four times to anybody hearing the grid rather than looking at it.
 */
function chipsFor(
  times: string[],
  column: Column,
  onSelect?: (id: string) => void,
): CalendarChip[] {
  return times.map((time) => ({
    id: time,
    label: time,
    ...(onSelect
      ? { onSelect, ariaLabel: `Book ${time} on ${column.weekday} ${column.date}` }
      : {}),
  }));
}

const meta = {
  title: 'Components/Calendar',
  component: Calendar,
  args: {
    label: 'Week of 28 September',
    caption: 'Times shown in Asia/Kolkata',
    days: week(MONDAY, (_index, column) => ({ chips: chipsFor(OPEN_TIMES, column) })),
  },
  parameters: { frame: 'surface' },
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The teacher's own week: the windows they said they keep, drawn as ranges and not as buttons.
 * Nothing here is takeable — this screen reports a schedule, it does not sell one.
 */
export const TeacherWindows: Story = {
  args: {
    caption: 'Asia/Kolkata · 45-minute classes',
    days: week(MONDAY, (index) => {
      if (index >= 5) return { empty: 'No window' };
      if (index === 2) return { chips: [{ id: 'late', label: '11:00–12:30' }] };
      if (index === 4) return { chips: [{ id: 'evening', label: '18:00–19:30' }] };
      return { chips: [{ id: 'morning', label: '09:00–10:30' }] };
    }),
  },
};

/**
 * A student's grid: every minute a button, and the caption naming whose clock it is read in. This
 * week crosses into October, which is what each column's date line is for.
 */
export const Bookable: Story = {
  args: {
    caption: 'Times shown in Asia/Kolkata',
    days: week(MONDAY, (index, column) => {
      if (index === 3) return { empty: 'Fully booked' };
      if (index >= 5) return { empty: 'Closed' };
      return {
        state: index === 0 ? 'today' : 'default',
        chips: chipsFor(OPEN_TIMES, column, () => {}),
      };
    }),
  },
};

/**
 * The same grid wired to a choice: pressing a minute holds it as `selected` while the request is
 * made, so the click is visibly answered before the server replies.
 */
function PickableWeek() {
  const [choice, setChoice] = useState<{ key: string; time: string } | null>(null);

  const days = week(MONDAY, (index, column) => {
    if (index >= 5) return { empty: 'Closed' };
    const chips = chipsFor(OPEN_TIMES, column, (time) => setChoice({ key: column.key, time })).map(
      (chip) =>
        choice?.key === column.key && choice.time === chip.id
          ? { ...chip, tone: 'selected' as const }
          : chip,
    );
    return { chips };
  });

  const chosen = days.find((day) => day.key === choice?.key);

  return (
    <div className="w-full max-w-3xl">
      <Calendar
        label="Week of 28 September"
        caption={
          choice
            ? `${choice.time} on ${chosen?.date} · Asia/Kolkata`
            : 'Times shown in Asia/Kolkata'
        }
        days={days}
      />
    </div>
  );
}

export const Selectable: Story = {
  render: () => <PickableWeek />,
};

/**
 * The minute the person has chosen, held in `selected` beside the ones still open. A grid that
 * only clears the choice after the server answers leaves them wondering whether the click landed.
 */
export const Selected: Story = {
  args: {
    caption: 'Times shown in Asia/Kolkata',
    days: week(MONDAY, (index) => {
      if (index >= 4) return { empty: 'Nothing left' };
      return {
        chips: [
          { id: '09:00', label: '09:00' },
          { id: '09:30', label: '09:30', tone: 'selected' },
          { id: '10:00', label: '10:00' },
        ],
      };
    }),
  },
};

/**
 * The same minute before and after the teacher answers. These two tones are the whole point of the
 * inbox: a student is waiting on exactly that difference, so no screen may draw them alike.
 */
export const PendingAndConfirmed: Story = {
  args: {
    caption: 'Your classes · Asia/Kolkata',
    days: week(MONDAY, (index) => {
      if (index === 1) return { chips: [{ id: 'a', label: '11:00', tone: 'pending' }] };
      if (index === 2) return { chips: [{ id: 'b', label: '15:00', tone: 'confirmed' }] };
      if (index === 4)
        return {
          chips: [
            { id: 'c', label: '09:00', tone: 'confirmed' },
            { id: 'd', label: '09:30', tone: 'pending' },
          ],
        };
      return { empty: 'Nothing booked' };
    }),
  },
};

/**
 * A week that is over, with both arrows stopped. The grid still shows what was there — the past is
 * the one thing a calendar should never blank out.
 */
export const PastWeek: Story = {
  args: {
    label: 'Week of 21 September',
    caption: 'Booking opens 30 days ahead',
    previousDisabled: true,
    nextDisabled: true,
    days: week('2026-09-21', () => ({
      state: 'outside',
      chips: [{ id: 'gone', label: '09:00', tone: 'closed' }],
    })),
  },
};

/** This week's request is in flight: the columns stay, the presses do not. */
export const Busy: Story = {
  args: {
    busy: true,
    caption: 'Loading this week…',
    days: week(MONDAY, (_index, column) => ({
      chips: chipsFor(OPEN_TIMES, column, () => {}),
    })),
  },
};

/**
 * The arrows only appear when someone passes a handler, so a calendar fixed to one week cannot
 * sprout controls that do nothing. `previousDisabled` holds at the earliest bookable week.
 */
function WalkableWeeks() {
  const [offset, setOffset] = useState(0);
  const start = new Date(Date.parse(`${MONDAY}T00:00:00Z`) + offset * 7 * 86_400_000);
  const iso = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;

  return (
    <div className="w-full max-w-3xl">
      <Calendar
        label={`Week of ${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`}
        caption="Times shown in Asia/Kolkata"
        days={week(iso, (index, column) =>
          index >= 5 ? { empty: 'Closed' } : { chips: chipsFor(['10:00', '16:00'], column) },
        )}
        onPrevious={() => setOffset((value) => value - 1)}
        onNext={() => setOffset((value) => value + 1)}
        previousDisabled={offset <= 0}
      />
    </div>
  );
}

export const Navigable: Story = {
  render: () => <WalkableWeeks />,
};

/** Seven columns, seven explanations, no silent gaps. */
export const NothingToBook: Story = {
  args: {
    caption: 'This teacher has not set any windows yet',
    days: week(MONDAY, () => ({ empty: 'No window' })),
  },
};
