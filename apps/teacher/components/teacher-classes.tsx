'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EmptyState,
  ErrorState,
  Icon,
  Illo,
  SkeletonGroup,
  StatusPill,
  buttonClass,
  cn,
  type StatusTone,
} from '@lms/ui';
import {
  BLOCKING_BOOKING_STATUSES,
  BOOKING_STATUS_CODES,
  BOOKING_STATUS_LABELS,
  type BookingRequest,
  type BookingStatusCode,
} from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { listClasses } from '@/lib/bookings';
import { formatClassWindow } from '@/lib/dates';

import { useSession } from './session-provider';

/**
 * Which colour a status wears, chosen by what it asks of the teacher reading it: amber while a
 * minute is held and unanswered, green once the class is on, ember for the one that slipped
 * through without an answer, and grey for a class that is simply over.
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

function isComingUp(booking: BookingRequest, now: number): boolean {
  return (
    BLOCKING_BOOKING_STATUSES.includes(booking.status) && Date.parse(booking.startsAt) > now
  );
}

/**
 * The teacher's classes, in the order they happen.
 *
 * The API hands back every booking that ever held this teacher's minute — waiting, confirmed,
 * cancelled, refused, expired — because the list *is* the schedule and a schedule keeps what
 * happened on it. Only two of those statuses still mean "a class is coming", and even those stop
 * meaning it once the hour goes by: Phase 4 has nothing that marks a class taught, so reading the
 * status alone would leave a Monday lesson in "Coming up" on Wednesday. The split is therefore
 * made on the time, and the status stays what each row says about itself.
 *
 * The words come from `BOOKING_STATUS_LABELS` rather than from this screen, so the same class
 * reads the same way here and on the student's own list.
 */
export function TeacherClasses() {
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    classes: BookingRequest[];
    /** The instant this read arrived, kept with it so the split below is the same one on the
     * server's pass and the client's — a clock read while rendering disagrees with itself. */
    now: number;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const key = String(attempt);

  useEffect(() => {
    let alive = true;

    listClasses()
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

  if (failed) {
    return (
      <ErrorState title="Your classes did not load" message={failed.message} onRetry={reload} />
    );
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

  const { classes, now } = settled;

  if (classes.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
          title="No classes booked yet"
          description="A student who takes one of your slots lands in your requests first, and here once you confirm it."
        />
        <ToRequests />
      </div>
    );
  }

  const upcoming = classes.filter((booking) => isComingUp(booking, now));
  const earlier = classes.filter((booking) => !isComingUp(booking, now));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-label text-ink">
        {`${classes.length} ${classes.length === 1 ? 'class' : 'classes'} on your schedule`}
        <span className="text-ink-faint">{` · your clock, ${zone}`}</span>
      </p>

      <Section
        heading="Coming up"
        bookings={upcoming}
        timezone={user?.timezone}
        empty="Nothing is waiting to happen yet."
      />
      {earlier.length > 0 ? (
        <Section
          heading="Earlier"
          bookings={earlier}
          timezone={user?.timezone}
          empty="Nothing has been and gone."
        />
      ) : null}

      <ToRequests />
    </div>
  );
}

/**
 * The other half of the same week. A teacher who lands here looking for a class that is not on it
 * — because they have not answered it yet — is one click from the screen that holds it.
 */
function ToRequests() {
  return (
    <p className="text-[0.8125rem] text-ink-faint">
      <Link
        href="/requests"
        className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), '-ml-3')}
      >
        Open the requests
      </Link>
    </p>
  );
}

/**
 * One half of the schedule. A section with nothing in it is drawn rather than hidden when it is
 * the half the teacher is here for — "Coming up: nothing" is the answer to the question the page
 * was opened to ask, and hiding it would leave the count line as the only reply.
 */
function Section({
  heading,
  bookings,
  timezone,
  empty,
}: {
  heading: string;
  bookings: BookingRequest[];
  timezone: string | null | undefined;
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
                <h3 className="text-h3 text-ink-strong">{booking.student.displayName}</h3>
                <p className="mt-0.5 truncate text-[0.8125rem] text-ink-muted">
                  {booking.course.title}
                </p>
              </div>

              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <p className="tabular text-[0.8125rem] text-ink">
                  <Icon name="clock" size="sm" />
                  <span className="ml-1.5">
                    {formatClassWindow(booking.startsAt, booking.endsAt, timezone)}
                  </span>
                </p>
                <div className="flex items-center gap-1.5">
                  <StatusPill tone={TONES[booking.status] ?? 'neutral'}>
                    {BOOKING_STATUS_LABELS[booking.status] ?? booking.status}
                  </StatusPill>
                  {booking.type === 'demo' ? <StatusPill tone="warning">Trial call</StatusPill> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
