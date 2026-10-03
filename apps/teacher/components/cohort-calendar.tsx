'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  EmptyState,
  ErrorState,
  Icon,
  Illo,
  SkeletonGroup,
  buttonClass,
  cn,
} from '@lms/ui';
import type { TeachingClassesResponse } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { myTeachingClasses } from '@/lib/cohort-classes';
import { formatClassWindow, readerZone } from '@/lib/dates';
import { buildTeachingWeeks } from '@/lib/teaching-week';

import { useSession } from './session-provider';

/**
 * Four classes to a column. A teacher who keeps a weekly class on four of their courses has four
 * classes on that weekday, and the tallest column in a week of seven sets the height of the six
 * quiet ones — so the fifth is folded behind a press that names its day, and every one of them is
 * in the list under the grid regardless.
 */
const CLASSES_A_COLUMN_SHOWS = 4;

/**
 * The teacher's dated calendar: what the sweep wrote down for the weeks ahead.
 *
 * This is the screen that answers "what do I teach on Tuesday", and only the rows can answer it —
 * the table holds the classes a series stands for *and* the days this teacher marked off, and no
 * recomputation from the patterns holds both. The availability week, the series and the holidays are
 * where the plans are written; nothing here edits them, because a dated class has no write route:
 * the pattern owns it. The one thing a row does offer is its roll, and that writes beside the class
 * rather than into it — the names and their marks, never the minute they stand in. So every chip is
 * static text — a control on this grid would be a button the API refuses the moment it is pressed —
 * and the detail a column of clock faces cannot hold, the course and how many people are standing
 * for it, is the list under the grid. The one press the grid does have folds a busy day, and it
 * writes nothing: it opens the column.
 *
 * Paging moves a whole week at a time, opens on the week the teacher is standing in, and stops at
 * the last one the horizon covers. Past that there is no calendar for the platform to stand behind,
 * and an empty grid would read as a quiet fortnight rather than as the end of what has been written
 * down. Behind today the window reaches a week, because the class that has already started is the
 * one whose roll is being marked.
 *
 * The weeks are cut, and the column that is "today" chosen, in the teacher's own zone against the
 * instant the read landed rather than a clock read while rendering: a date worked out during render
 * is one instant on the server and another in the browser, and a calendar that disagrees with itself
 * about which column is today is a hydration bug with a friendly face.
 */
export function CohortCalendar() {
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    calendar: TeachingClassesResponse;
    /** The instant this read arrived, kept with it so the week the grid opens on is the week the API
     * was asked about. */
    now: number;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  // Null until the teacher moves: the grid then opens on the week they are standing in, which is not
  // the first week the window covers now that the read reaches back a week for the class that has
  // already started.
  const [week, setWeek] = useState<number | null>(null);

  const key = String(attempt);

  useEffect(() => {
    let alive = true;

    myTeachingClasses()
      .then((calendar) => {
        if (alive) setSettled({ key, calendar, now: Date.now() });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key]);

  function reload() {
    setAttempt((current) => current + 1);
  }

  const failed = settled?.key !== key && failure?.key === key ? failure : null;

  if (failed) {
    return (
      <ErrorState title="Your calendar did not load" message={failed.message} onRetry={reload} />
    );
  }

  if (settled === null) {
    return (
      <SkeletonGroup
        rows={2}
        rowClassName="h-[13.5rem] w-full rounded-card"
        label="Loading your calendar"
        className="flex flex-col gap-4"
      />
    );
  }

  const { calendar, now } = settled;
  const zone = readerZone(user?.timezone);

  if (calendar.items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
          title="No classes on your calendar yet"
          description="A series is what writes them: keep a course its weeks, and the classes land here a month ahead — with the days you have marked off left empty."
        />
        <p className="text-[0.8125rem] text-ink-faint">
          <Link
            href="/courses"
            className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), '-ml-3')}
          >
            Open your courses
          </Link>
        </p>
      </div>
    );
  }

  const weeks = buildTeachingWeeks(calendar, zone, now);
  const standingIn = weeks.findIndex((row) => row.days.some((day) => day.state === 'today'));
  const index = Math.min(Math.max(week ?? Math.max(standingIn, 0), 0), weeks.length - 1);
  const current = weeks[index];
  if (!current) return null;

  return (
    <div className="flex flex-col gap-5">
      <Calendar
        label={current.label}
        caption={`Your clock, ${zone}`}
        days={current.days}
        maxChipsPerDay={CLASSES_A_COLUMN_SHOWS}
        onPrevious={() => setWeek(index - 1)}
        onNext={() => setWeek(index + 1)}
        previousDisabled={index === 0}
        nextDisabled={index === weeks.length - 1}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-label uppercase tracking-wide text-ink-faint">The week’s classes</h2>

        {current.classes.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-paper px-4 py-5 text-[0.8125rem] text-ink-muted">
            Nothing is scheduled for this week.
          </p>
        ) : (
          <ul aria-label="The week’s classes" className="flex flex-col gap-3">
            {current.classes.map((row) => (
              <li
                key={row.id}
                data-icon-zone
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4 sm:p-5"
              >
                <div className="min-w-0">
                  <h3 className="text-h3">
                    <Link
                      href={`/courses/${row.course.id}/edit`}
                      className="text-ink-strong underline-offset-4 hover:underline"
                    >
                      {row.course.title}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-faint">
                    {`${row.studentsExpected} ${row.studentsExpected === 1 ? 'student' : 'students'} expected`}
                  </p>
                </div>

                <p className="tabular text-[0.8125rem] text-ink">
                  <Icon name="clock" size="sm" />
                  <span className="ml-1.5">
                    {formatClassWindow(row.startsAt, row.endsAt, zone)}
                  </span>
                </p>

                <Link
                  href={`/calendar/class/${row.id}`}
                  className={cn(buttonClass({ variant: 'ghost', size: 'sm' }))}
                >
                  Mark the roll
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[0.8125rem] text-ink-faint">
        <Link
          href="/classes"
          className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), '-ml-3')}
        >
          Open the classes students booked
        </Link>
      </p>
    </div>
  );
}
