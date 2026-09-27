'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './Icon';

/**
 * How a chip sits on the week, in the states a calendar has to tell apart.
 *
 * `available` and `selected` are the two a person is acting on, and a portal decides which of
 * them is a button by whether it gave the chip a handler; `pending` and `confirmed` are the same
 * minute after somebody has asked for it and after the teacher has said yes, which no screen may
 * blur into the other because the student is waiting on exactly that difference. `closed` is the
 * quiet one — a minute the grid still remembers, and nobody can take.
 */
export type CalendarChipTone = 'available' | 'selected' | 'pending' | 'confirmed' | 'closed';

export interface CalendarChip {
  id: string;
  /** The clock face, or a window: `09:00`, `09:00–10:30`. Tabular figures keep a column straight. */
  label: string;
  tone?: CalendarChipTone;
  /**
   * The whole difference between a chip that can be taken and a chip that is only reported. With
   * no handler the chip draws as static text, so a minute that belongs to somebody else never
   * looks like a button that does nothing.
   */
  onSelect?: (id: string) => void;
  /**
   * What the chip says out loud. A bare `09:00` is a time with no date attached, and a screen
   * reader reaching the fourth column hears the same two words four times over.
   */
  ariaLabel?: string;
}

/** Whether the column is the day being lived through, an ordinary day, or one outside the range. */
export type CalendarDayState = 'default' | 'today' | 'outside';

export interface CalendarDay {
  /** The local date the column stands for — `2026-09-28`. Also the key React draws by. */
  key: string;
  /** `Mon`. Written by whoever owns the week, because a grid has no idea what day it is. */
  weekday: string;
  /** `28 Sep`. Shown under the weekday so a week that crosses a month reads without counting. */
  date?: string;
  state?: CalendarDayState;
  chips?: CalendarChip[];
  /** What to say when `chips` is empty. A day with nothing on it is an answer, not a gap. */
  empty?: string;
}

export interface CalendarProps {
  days: CalendarDay[];
  /** Names the grid to the person using a keyboard: `Week of 28 September`. */
  label: string;
  /**
   * Whose clock the grid is read in. Every time on it was cut in somebody else's zone, and a
   * student who is not told that books an hour that already went by.
   */
  caption?: ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  /** The week's own request is in flight: keep the grid, refuse the presses. */
  busy?: boolean;
  className?: string;
}

const CHIP: Record<CalendarChipTone, string> = {
  available: 'border-line bg-surface text-ink hover:border-brand-line hover:bg-brand-soft',
  selected: 'border-brand bg-brand-soft text-brand-deep',
  pending: 'border-warning-soft bg-warning-soft text-warning',
  confirmed: 'border-success-soft bg-success-soft text-success',
  closed: 'border-line bg-paper-sunk text-ink-faint',
};

const CHIP_BASE = [
  'block w-full truncate rounded-field border px-2 py-1.5 text-[0.8125rem] leading-none tabular',
  'text-center transition-[background-color,border-color,color] duration-[var(--duration-fast)]',
  'ease-[var(--ease-out)]',
];

const DAY: Record<CalendarDayState, string> = {
  default: 'bg-surface',
  today: 'bg-brand-soft',
  outside: 'bg-paper-sunk',
};

function Chip({ chip, busy }: { chip: CalendarChip; busy: boolean }) {
  const tone = chip.tone ?? 'available';
  const colors = CHIP[tone];

  if (!chip.onSelect) {
    return (
      <span data-tone={tone} className={cn(CHIP_BASE, 'pointer-events-none select-none', colors)}>
        {chip.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-tone={tone}
      disabled={busy}
      aria-label={chip.ariaLabel ?? chip.label}
      onClick={() => chip.onSelect?.(chip.id)}
      className={cn(
        CHIP_BASE,
        colors,
        'disabled:pointer-events-none disabled:opacity-55',
        'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-line',
      )}
    >
      {chip.label}
    </button>
  );
}

/**
 * A week of days, each with whatever sits on it.
 *
 * Deliberately ignorant of where its days came from: the arithmetic that turns instants into
 * columns belongs to `@lms/shared`, so a portal that grouped them wrongly would be showing a
 * class on the wrong Tuesday in one screen and the right one in another. What this component owns
 * is the promise a calendar makes instead — that the things you can act on are the only things
 * drawn as controls, that an empty day explains itself, and that nobody reads a time without
 * being told whose time it is.
 */
export function Calendar({
  days,
  label,
  caption,
  onPrevious,
  onNext,
  previousDisabled = false,
  nextDisabled = false,
  busy = false,
  className,
}: CalendarProps) {
  const captionId = useId();

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={busy || undefined}
      aria-describedby={caption ? captionId : undefined}
      className={cn('overflow-hidden rounded-card border border-line bg-surface', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-label text-ink-strong">{label}</h3>
          {caption ? (
            <span id={captionId} className="text-[0.8125rem] text-ink-faint">
              {caption}
            </span>
          ) : null}
        </div>

        {onPrevious || onNext ? (
          <div className="flex items-center gap-1">
            {onPrevious ? (
              <button
                type="button"
                aria-label="Previous week"
                disabled={busy || previousDisabled}
                onClick={onPrevious}
                className={NAV_ARROW}
              >
                <Icon name="chevron-left" size="sm" />
              </button>
            ) : null}
            {onNext ? (
              <button
                type="button"
                aria-label="Next week"
                disabled={busy || nextDisabled}
                onClick={onNext}
                className={NAV_ARROW}
              >
                <Icon name="chevron-right" size="sm" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Seven columns have to be wide enough to hold a time each. Where the container cannot
          manage that, the week scrolls sideways rather than cutting a clock face in half —
          a truncated "09:30–11:…" is a time a teacher cannot book against. */}
      <div className="overflow-x-auto">
        <ul className="grid grid-cols-1 gap-px bg-line sm:min-w-[52.5rem] sm:grid-cols-7">
          {days.map((day) => {
            const state = day.state ?? 'default';
            const chips = day.chips ?? [];

            return (
              <li
                key={day.key}
                data-key={day.key}
                data-state={state}
                className={cn('flex flex-col gap-1.5 p-2', DAY[state])}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={cn(
                      'text-eyebrow uppercase',
                      state === 'today' ? 'text-brand-deep' : 'text-ink-faint',
                    )}
                  >
                    {day.weekday}
                  </span>
                  {state === 'today' ? (
                    <span className="text-eyebrow text-brand-deep">Today</span>
                  ) : null}
                </div>
                {day.date ? (
                  <span className="-mt-1 text-[0.6875rem] text-ink-faint tabular">{day.date}</span>
                ) : null}

                {chips.length === 0 ? (
                  day.empty ? (
                    <span className="rounded-field border border-dashed border-line px-2 py-1.5 text-center text-[0.6875rem] text-ink-faint">
                      {day.empty}
                    </span>
                  ) : null
                ) : (
                  chips.map((chip) => <Chip key={chip.id} chip={chip} busy={busy} />)
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const NAV_ARROW = [
  'grid size-7 place-items-center rounded-field border border-line text-ink-muted',
  'transition-[background-color,color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
  'hover:border-ink-faint hover:bg-paper hover:text-ink',
  'disabled:pointer-events-none disabled:opacity-55',
  'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-line',
].join(' ');
