'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Illo,
  SkeletonGroup,
  StatusPill,
  buttonClass,
  cn,
  notify,
  type StatusTone,
} from '@lms/ui';
import {
  API_ERROR_CODES,
  BOOKING_STATUS_CODES,
  BOOKING_STATUS_LABELS,
  CANCELLABLE_BOOKING_STATUSES,
  type Booking,
  type BookingStatusCode,
} from '@lms/shared';

import { ApiError, describeFailure } from '@/lib/api';
import { leaveClass, myBookings } from '@/lib/bookings';
import { formatClassWindow } from '@/lib/dates';

import { useSession } from './session-provider';

/**
 * Which colour a status wears, chosen by what it asks of the student reading it: amber while the
 * teacher has not answered, green once the class is on, and grey for the ones that are simply
 * over — called off, refused, left to expire, taught or missed.
 */
const TONES: Record<BookingStatusCode, StatusTone> = {
  [BOOKING_STATUS_CODES.PENDING]: 'warning',
  [BOOKING_STATUS_CODES.CONFIRMED]: 'success',
  [BOOKING_STATUS_CODES.COMPLETED]: 'info',
  [BOOKING_STATUS_CODES.CANCELLED]: 'neutral',
  [BOOKING_STATUS_CODES.REJECTED]: 'neutral',
  [BOOKING_STATUS_CODES.EXPIRED]: 'ember',
  [BOOKING_STATUS_CODES.NO_SHOW]: 'danger',
};

interface Settled {
  key: string;
  classes: Booking[];
  /** The instant the read landed. The split below is a claim about that moment, and a clock read
   * while rendering is one instant on the server and another in the browser. */
  now: number;
}

function isComingUp(booking: Booking, now: number): boolean {
  return Date.parse(booking.startsAt) > now;
}

function standsToLeave(booking: Booking): boolean {
  return CANCELLABLE_BOOKING_STATUSES.includes(booking.status);
}

/**
 * The student's own calendar, which is the one list on this portal that is theirs.
 *
 * The rows are read from the person rather than from a course, so a student with three teachers
 * keeps one schedule here. Each row is shown in the student's clock, not the teacher's: the grid
 * that offered the minute belonged to the teacher's week, but the class is something this person
 * has to be awake for, and the same instant on two walls is the one place a mistake costs an
 * hour.
 *
 * The split is on the date and nothing else. On the status alone a confirmed class would go on
 * being "coming up" after its hour passed, because Phase 4 has nothing that marks a class taught;
 * on whether the minute is still held, a class this student called off would vanish from the week
 * it happened in. The date is the only fact on a row that never changes.
 *
 * Leaving is one press, and the list is read again after it rather than edited in place: whether
 * the class stood down or the teacher answered it a second earlier, the honest answer is the one
 * the API gives next time it is asked.
 */
export function MyClasses() {
  const router = useRouter();
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);

  const key = String(attempt);

  useEffect(() => {
    let alive = true;

    myBookings()
      .then((classes) => {
        if (alive) setSettled({ key, classes, now: Date.now() });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key]);

  const failed = settled?.key !== key && failure?.key === key ? failure : null;
  const zone = user?.timezone ?? 'your own clock';

  function reload() {
    setAttempt((current) => current + 1);
  }

  async function leave(booking: Booking) {
    if (leaving !== null) return;

    setLeaving(booking.id);
    setStale(null);

    let conflict: string | null = null;
    let left = true;
    try {
      await leaveClass(booking.id);
    } catch (error: unknown) {
      left = false;
      if (error instanceof ApiError && error.code === API_ERROR_CODES.CONFLICT) {
        conflict = describeFailure(error);
      } else {
        notify.error(describeFailure(error));
      }
    }

    setLeaving(null);
    setStale(conflict);
    if (left) notify.success(`Left ${booking.course.title}`);
    // The row's status is the server's fact now, and a class the teacher answered while this press
    // was in flight is a row this screen has no right to draw from memory. A refusal that is not
    // about the class changed nothing anywhere, so the list on screen is still true.
    if (left || conflict !== null) reload();
  }

  if (failed) {
    return <ErrorState title="Your classes did not load" message={failed.message} onRetry={reload} />;
  }

  if (settled === null) {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-20 w-full rounded-card"
        label="Loading your classes"
        className="flex flex-col gap-3"
      />
    );
  }

  const classes = settled.classes;

  if (classes.length === 0) {
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-sitting-17.svg" size="lg" />}
        title="No classes yet"
        description="A course you are inside has a calendar of its own to book from, and anything you ask for lands here."
        actionLabel="Browse the shelf"
        onAction={() => router.push('/')}
      />
    );
  }

  const upcoming = classes.filter((booking) => isComingUp(booking, settled.now));
  const earlier = classes.filter((booking) => !isComingUp(booking, settled.now));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-label text-ink">
        {`${classes.length} ${classes.length === 1 ? 'class' : 'classes'} on your calendar`}
        <span className="text-ink-faint">{` · your clock, ${zone}`}</span>
      </p>

      {stale ? (
        <p
          role="status"
          className="rounded-field border border-warning-soft bg-warning-soft px-3 py-2 text-[0.8125rem] text-warning"
        >
          {stale}
        </p>
      ) : null}

      <Section
        heading="Coming up"
        bookings={upcoming}
        timezone={user?.timezone}
        leaving={leaving}
        onLeave={leave}
        empty="Nothing is waiting to happen. A course you are inside has a calendar to book from."
      />
      {earlier.length > 0 ? (
        <Section
          heading="Earlier"
          bookings={earlier}
          timezone={user?.timezone}
          leaving={leaving}
          onLeave={leave}
          empty="Nothing has been and gone."
        />
      ) : null}

      <p className="text-[0.8125rem] text-ink-faint">
        <Link
          href="/my-courses"
          className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), '-ml-3')}
        >
          Open your courses
        </Link>
      </p>
    </div>
  );
}

/**
 * One half of the calendar. "Coming up: nothing" is drawn rather than hidden, because it is the
 * answer to the question the page was opened to ask.
 */
function Section({
  heading,
  bookings,
  timezone,
  leaving,
  onLeave,
  empty,
}: {
  heading: string;
  bookings: Booking[];
  timezone: string | null | undefined;
  leaving: string | null;
  onLeave: (booking: Booking) => Promise<void>;
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label uppercase tracking-wide text-ink-faint">{heading}</h2>

      {bookings.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-paper px-4 py-5 text-[0.8125rem] text-ink-muted">
          {empty}
        </p>
      ) : (
        <ul aria-label={heading} className="flex flex-col gap-3">
          {bookings.map((booking) => (
            <li
              key={booking.id}
              data-icon-zone
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <div className="min-w-0">
                <h3 className="text-h3">
                  <Link
                    href={`/courses/${booking.course.id}`}
                    className="text-ink-strong underline-offset-4 hover:underline"
                  >
                    {booking.course.title}
                  </Link>
                </h3>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <StatusPill tone={TONES[booking.status] ?? 'neutral'}>
                    {BOOKING_STATUS_LABELS[booking.status] ?? booking.status}
                  </StatusPill>
                  {booking.type === 'demo' ? (
                    <StatusPill tone="warning">Trial call</StatusPill>
                  ) : null}
                </div>
              </div>

              <div className="flex min-w-0 flex-col items-start gap-2">
                <p className="tabular text-[0.8125rem] text-ink">
                  <Icon name="clock" size="sm" />
                  <span className="ml-1.5">
                    {formatClassWindow(booking.startsAt, booking.endsAt, timezone)}
                  </span>
                </p>
                {standsToLeave(booking) && heading === 'Coming up' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    loading={leaving === booking.id}
                    disabled={leaving !== null && leaving !== booking.id}
                    onClick={() => void onLeave(booking)}
                  >
                    Leave this class
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
