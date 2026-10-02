import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Calendar, type CalendarChip, type CalendarDay } from './Calendar';

/**
 * The one grid both portals draw: a teacher's standing week, a student's calendar of what they
 * have asked for, and the offer sheet between them. What is tested is the contract those three
 * screens share and cannot each reinvent — a minute somebody can take is a button and a minute
 * they cannot is not, a day with nothing on it says why, and a grid still loading refuses the
 * press that would be answered by the grid it is about to become.
 *
 * Nothing here is about where the days came from. `Calendar` is given columns and draws them;
 * the arithmetic that turns instants into a week lives in `@lms/shared`, because a date that
 * meant two different things in two portals would be the same bug wearing two faces.
 */
function day(overrides: Partial<CalendarDay> = {}): CalendarDay {
  return {
    key: '2026-09-28',
    weekday: 'Mon',
    date: '28 Sep',
    chips: [{ id: '0900', label: '09:00' }],
    ...overrides,
  };
}

/** Seven columns, Monday first, the way a week is read. */
function week(map?: (index: number) => Partial<CalendarDay>): CalendarDay[] {
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const keys = [
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
  ];
  const dates = ['28 Sep', '29 Sep', '30 Sep', '1 Oct', '2 Oct', '3 Oct', '4 Oct'];

  return weekdays.map((weekday, index) =>
    day({ weekday, key: keys[index], date: dates[index], ...map?.(index) }),
  );
}

const columns = () => screen.getAllByRole('listitem');

describe('Calendar', () => {
  it('draws one column per day, in the order the portal grouped them', () => {
    render(<Calendar days={week()} label="Week of 28 September" />);

    expect(columns().map((column) => column.getAttribute('data-key'))).toEqual(
      week().map((entry) => entry.key),
    );
    expect(columns()[0]).toHaveTextContent('Mon');
    expect(columns()[6]).toHaveTextContent('4 Oct');
  });

  it('names the week, and says whose clock the times are read in', () => {
    render(
      <Calendar
        days={week()}
        label="Week of 28 September"
        caption="Asia/Kolkata — 2 hours 30 minutes ahead of you"
      />,
    );

    const grid = screen.getByRole('group', { name: 'Week of 28 September' });
    const caption = screen.getByText('Asia/Kolkata — 2 hours 30 minutes ahead of you');
    // The zone is part of the grid's own description rather than a paragraph beside it: read
    // alone, "09:00" is a number that means nothing to nobody.
    expect(grid.getAttribute('aria-describedby')).toBe(caption.id);
  });

  it('makes a minute that can be taken a button, and says out loud which minute it is', async () => {
    const onSelect = vi.fn();
    render(
      <Calendar
        days={[
          day({
            chips: [
              {
                id: '0900',
                label: '09:00',
                onSelect,
                ariaLabel: 'Ask for Monday 28 September at 09:00',
              },
            ],
          }),
        ]}
        label="Week"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ask for Monday 28 September at 09:00' }));

    expect(onSelect).toHaveBeenCalledWith('0900');
  });

  it('leaves a minute nobody can take out of the tab order', () => {
    render(
      <Calendar
        days={[day({ chips: [{ id: '0900', label: '09:00', tone: 'confirmed' }] })]}
        label="Week"
      />,
    );

    // A class that is already a class is a fact about the week, not a control. Drawing it as a
    // button would put a stop in the tab order that does nothing when reached.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('09:00')).toHaveAttribute('data-tone', 'confirmed');
  });

  it('carries the tone it was given, so a state is drawn rather than guessed', () => {
    render(
      <Calendar
        days={[
          day({
            chips: [
              { id: 'a', label: '09:00' },
              { id: 'b', label: '10:00', tone: 'pending' },
              { id: 'c', label: '11:00', tone: 'selected' },
              { id: 'd', label: '12:00', tone: 'closed' },
            ],
          }),
        ]}
        label="Week"
      />,
    );

    expect(screen.getByText('09:00')).toHaveAttribute('data-tone', 'available');
    expect(screen.getByText('10:00')).toHaveAttribute('data-tone', 'pending');
    expect(screen.getByText('11:00')).toHaveAttribute('data-tone', 'selected');
    expect(screen.getByText('12:00')).toHaveAttribute('data-tone', 'closed');
  });

  it('says why a day is empty, and only on the days that were told', () => {
    render(
      <Calendar
        days={week((index) => (index === 6 ? { chips: [], empty: 'Nothing left to book' } : { chips: [] }))}
        label="Week"
      />,
    );

    // Six columns with nothing in them and no line to invent: an empty day is only "closed" or
    // "nothing left" if the screen that owns the week has read it that way.
    expect(screen.getAllByText('Nothing left to book')).toHaveLength(1);
  });

  it('marks the day that is today, and names the ones outside the range', () => {
    render(
      <Calendar
        days={week((index) =>
          index === 6 ? { state: 'today' } : index === 1 ? { state: 'outside' } : {},
        )}
        label="Week"
      />,
    );

    expect(columns()[6]).toHaveAttribute('data-state', 'today');
    expect(columns()[1]).toHaveAttribute('data-state', 'outside');
    expect(columns()[0]).toHaveAttribute('data-state', 'default');
    // A day is today for whoever is reading it, so the word belongs to the grid and not to the
    // date the portal was handed.
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('walks the weeks when the portal has somewhere to walk to', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<Calendar days={week()} label="Week" onPrevious={onPrevious} onNext={onNext} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('offers no arrows to a grid that does not move', () => {
    render(<Calendar days={week()} label="Week" />);

    expect(screen.queryByRole('button', { name: 'Previous week' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next week' })).toBeNull();
  });

  it('stops at the edges of the range it was given', async () => {
    const onNext = vi.fn();
    render(
      <Calendar
        days={week()}
        label="Week"
        onPrevious={() => {}}
        onNext={onNext}
        nextDisabled
      />,
    );

    const next = screen.getByRole('button', { name: 'Next week' });
    expect(next).toBeDisabled();
    // A disabled control cannot be clicked, so the handler staying quiet is the assertion.
    await userEvent.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('holds the grid still while the next week is on its way', () => {
    render(
      <Calendar
        days={[day({ chips: [{ id: '0900', label: '09:00', onSelect: () => {} }] })]}
        label="Week"
        onNext={() => {}}
        busy
      />,
    );

    expect(screen.getByRole('group', { name: 'Week' })).toHaveAttribute('aria-busy', 'true');
    // The grid on screen is the one the next answer is about to replace, and a minute taken from
    // it is a press on a time that may not be on offer any more.
    expect(screen.getByRole('button', { name: '09:00' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  });

  /**
   * A teacher who keeps a weekly class on four courses has four chips on that weekday, and the
   * seven columns are one row: the tallest column sets the height of all six others, so a calendar
   * of a busy Monday is a wall of eight empty boxes under a quiet Tuesday. Whoever owns the week
   * says how many columns it will show; the rest stay one press away and never vanish.
   */
  describe('a day with more on it than the grid shows', () => {
    const BUSY = ['09:00', '10:00', '11:00', '12:00', '14:00', '16:00'];

    function onDay(times: string[]): CalendarChip[] {
      return times.map((time) => ({ id: time, label: time, tone: 'confirmed' as const }));
    }

    function timesDrawn() {
      return screen.getAllByText(/^\d\d:\d\d$/).map((chip) => chip.textContent);
    }

    /** A column the tests can hold on to, rather than an index that might not be a column. */
    function columnAt(index: number): HTMLElement {
      const found = columns()[index];
      if (!found) throw new Error(`no column at index ${index}`);
      return found;
    }

    it('shows the ones it was told to and folds the rest behind a press', () => {
      render(<Calendar days={[day({ chips: onDay(BUSY) })]} label="Week" maxChipsPerDay={4} />);

      expect(timesDrawn()).toEqual(['09:00', '10:00', '11:00', '12:00']);
      const more = screen.getByRole('button', { name: '+2 more on Mon 28 Sep' });
      expect(more).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens the folded chips in place, and folds them back', async () => {
      const user = userEvent.setup();
      render(<Calendar days={[day({ chips: onDay(BUSY) })]} label="Week" maxChipsPerDay={4} />);

      await user.click(screen.getByRole('button', { name: '+2 more on Mon 28 Sep' }));
      expect(timesDrawn()).toEqual(BUSY);
      expect(screen.getByRole('button', { name: 'Show fewer on Mon 28 Sep' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );

      await user.click(screen.getByRole('button', { name: 'Show fewer on Mon 28 Sep' }));
      expect(timesDrawn()).toEqual(['09:00', '10:00', '11:00', '12:00']);
    });

    it('says nothing about more on a day that fits', () => {
      render(
        <Calendar
          days={[day({ chips: onDay(BUSY.slice(0, 4)) })]}
          label="Week"
          maxChipsPerDay={4}
        />,
      );

      expect(timesDrawn()).toEqual(BUSY.slice(0, 4));
      expect(screen.queryByRole('button', { name: /more/i })).toBeNull();
    });

    it('draws every chip a grid was given when nobody set a cap', () => {
      render(<Calendar days={[day({ chips: onDay(BUSY) })]} label="Week" />);

      expect(timesDrawn()).toEqual(BUSY);
      expect(screen.queryByRole('button', { name: /more/i })).toBeNull();
    });

    it('folds each day on its own, so a busy Monday says nothing about a busy Tuesday', async () => {
      const user = userEvent.setup();
      render(
        <Calendar
          days={week((index) =>
            index === 0 || index === 1
              ? { chips: onDay(BUSY) }
              : { chips: onDay(BUSY.slice(0, 2)) },
          )}
          label="Week"
          maxChipsPerDay={4}
        />,
      );

      const monday = within(columnAt(0));
      const tuesday = within(columnAt(1));

      await user.click(screen.getByRole('button', { name: '+2 more on Mon 28 Sep' }));

      expect(monday.getByRole('button', { name: 'Show fewer on Mon 28 Sep' })).toBeInTheDocument();
      expect(tuesday.getByRole('button', { name: '+2 more on Tue 29 Sep' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });
  });
});
