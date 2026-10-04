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
  ATTENDANCE_STATUS_CODES,
  ATTENDANCE_STATUS_LABELS,
  BOOKING_STATUS_CODES,
  BOOKING_STATUS_LABELS,
  CANCELLABLE_BOOKING_STATUSES,
  type AssignedClass,
  type AttendanceStatusCode,
  type Booking,
  type BookingStatusCode,
  type LiveClassDoor,
} from '@lms/shared';

import { ApiError, describeFailure, isForbidden } from '@/lib/api';
import { myAssignedClasses } from '@/lib/cohort-classes';
import { joinRoom, leaveClass, myBookings } from '@/lib/bookings';
import { formatClassWindow, formatInstant } from '@/lib/dates';

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

/**
 * Which colour the teacher's word about this name wears. Green for the roll saying the class was
 * stood for, amber for the one saying it was not — and neither is a judgement this screen adds,
 * since the mark is the teacher's and the colour only keeps the two words apart at a glance.
 */
const MARK_TONES: Record<AttendanceStatusCode, StatusTone> = {
  [ATTENDANCE_STATUS_CODES.PRESENT]: 'success',
  [ATTENDANCE_STATUS_CODES.ABSENT]: 'warning',
};

/**
 * One line on this calendar, from either of the two lists that build it.
 *
 * To a reader a class they booked and a class the course scheduled are the same thing: a minute
 * they are expected at. To the platform they are three different things — only the first has a
 * status of its own, a way out, or a room — so the booking rides along as a whole row or as
 * `null`, and everything that differs between the two kinds hangs off that one test. A scheduled
 * class gets no invented status word: `null` here means nobody has answered it, which is truer
 * than any label this screen could write.
 */
interface CalendarRow {
  /** The two lists come from different tables, so an id from one is not known to differ from an id
   * from the other. The kind is what makes one list of keys safe. */
  key: string;
  course: { id: string; slug: string; title: string };
  startsAt: string;
  endsAt: string;
  booking: Booking | null;
  /** What the teacher said about this name on a scheduled class, or null while nobody has. Only the
   * second kind of row can carry one: a booked class is a different arrangement, and its own status
   * pill already tells that story. */
  mark: AttendanceStatusCode | null;
}

/** One calendar, in the order the classes happen. */
function mergeRows(booked: Booking[], scheduled: AssignedClass[]): CalendarRow[] {
  return [
    ...booked.map((booking): CalendarRow => ({
      key: `booked-${booking.id}`,
      course: booking.course,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      booking,
      mark: null,
    })),
    ...scheduled.map((row): CalendarRow => ({
      key: `scheduled-${row.id}`,
      course: row.course,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      booking: null,
      mark: row.status,
    })),
  ].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

interface Settled {
  key: string;
  classes: CalendarRow[];
  /** The instant the read landed. The split below is a claim about that moment, and a clock read
   * while rendering is one instant on the server and another in the browser. */
  now: number;
}

function isComingUp(row: CalendarRow, now: number): boolean {
  return Date.parse(row.startsAt) > now;
}

function standsToLeave(booking: Booking): boolean {
  return CANCELLABLE_BOOKING_STATUSES.includes(booking.status);
}

/** The heading says the account is not a learner's; this line says what follows from that here. */
const NOT_A_LEARNER_NOTE = 'It cannot hold a place, so no class is standing for it.';

interface Failure {
  key: string;
  message: string;
  /** A 403 is not a connection that failed: the same session gives the same answer when asked again,
   * so the retry is withheld and the sign-in is offered in its place. */
  notALearner: boolean;
}

/**
 * The student's own calendar, which is the one list on this portal that is theirs.
 *
 * The rows are read from the person rather than from a course, so a student with three teachers
 * keeps one schedule here. Two routes feed it — the classes this student asked for and the ones a
 * course's series wrote — and they arrive as one list, because a person has one diary and two
 * calendars is how somebody misses a class. Each row is shown in the student's clock, not the
 * teacher's: the grid that offered the minute belonged to the teacher's week, but the class is
 * something this person has to be awake for, and the same instant on two walls is the one place a
 * mistake costs an hour.
 *
 * The split is on the date and nothing else. On the status alone a confirmed class would go on
 * being "coming up" after its hour passed, because Phase 4 has nothing that marks a class taught;
 * on whether the minute is still held, a class this student called off would vanish from the week
 * it happened in. The date is the only fact on a row that never changes.
 *
 * Leaving is one press, and both lists are read again after it rather than edited in place: whether
 * the class stood down or the teacher answered it a second earlier, the honest answer is the one
 * the API gives next time it is asked. The pair is read together, and one refusal fails the whole
 * calendar — half a schedule is the worst thing this screen could draw, because the missing half
 * looks like a free day.
 */
export function MyClasses() {
  const router = useRouter();
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  /**
   * The door's clock, which moves while the page stands open.
   *
   * "Coming up" and "Earlier" are decided once, against the read that drew them — a class does not
   * walk itself between the two halves while a student is looking at it. A door is the opposite
   * question: it opens five minutes before the class and shuts a quarter of an hour after it, and
   * a page that froze that answer when it loaded would show a student who had come to attend the
   * lesson the very thing they cannot afford to miss.
   */
  const [doorTick, setDoorTick] = useState(0);

  const key = String(attempt);

  useEffect(() => {
    const every = setInterval(() => setDoorTick(Date.now()), 30_000);
    return () => clearInterval(every);
  }, []);

  useEffect(() => {
    let alive = true;

    Promise.all([myBookings(), myAssignedClasses()])
      .then(([booked, scheduled]) => {
        if (alive) setSettled({ key, classes: mergeRows(booked, scheduled), now: Date.now() });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const notALearner = isForbidden(error);
        setFailure({
          key,
          message: notALearner ? NOT_A_LEARNER_NOTE : describeFailure(error),
          notALearner,
        });
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
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          title={failed.notALearner ? 'This is not a learner account' : 'Your classes did not load'}
          message={failed.message}
          onRetry={failed.notALearner ? undefined : reload}
        />
        {failed.notALearner ? (
          <Link
            href={`/login?next=${encodeURIComponent('/my-classes')}`}
            className={buttonClass({ variant: 'secondary', size: 'sm' })}
          >
            Sign in as a learner
          </Link>
        ) : null}
      </div>
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

  const classes = settled.classes;

  if (classes.length === 0) {
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-sitting-17.svg" size="lg" />}
        title="No classes yet"
        description="Nothing is booked and no course of yours has put a class on your weeks yet. A course you are inside has a calendar of its own to book from, and anything you ask for lands here."
        actionLabel="Browse the shelf"
        onAction={() => router.push('/')}
      />
    );
  }

  const doorClock = Math.max(settled.now, doorTick);
  const upcoming = classes.filter((row) => isComingUp(row, settled.now));
  const earlier = classes.filter((row) => !isComingUp(row, settled.now));

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
        rows={upcoming}
        timezone={user?.timezone}
        clock={doorClock}
        leaving={leaving}
        onLeave={leave}
        empty="Nothing is waiting to happen. A course you are inside has a calendar to book from."
      />
      {earlier.length > 0 ? (
        <Section
          heading="Earlier"
          rows={earlier}
          timezone={user?.timezone}
          clock={doorClock}
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
 *
 * A row that came from a series carries the fact that it came from a series, and the one thing the
 * teacher wrote about this name: no way out and no door. Those two are a booking's story, and the
 * platform has no route behind either of them for a class this student never asked for — a pill that
 * said "confirmed" here would be reporting a teacher's silence as an answer. An unmarked line shows
 * no word at all, because nobody has said one.
 */
function Section({
  heading,
  rows,
  timezone,
  clock,
  leaving,
  onLeave,
  empty,
}: {
  heading: string;
  rows: CalendarRow[];
  timezone: string | null | undefined;
  /** The instant the doors are judged against, which moves while the page stands open. */
  clock: number;
  leaving: string | null;
  onLeave: (booking: Booking) => Promise<void>;
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label uppercase tracking-wide text-ink-faint">{heading}</h2>

      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-paper px-4 py-5 text-[0.8125rem] text-ink-muted">
          {empty}
        </p>
      ) : (
        <ul aria-label={heading} className="flex flex-col gap-3">
          {rows.map((row) => {
            const booking = row.booking;

            return (
              <li
                key={row.key}
                data-icon-zone
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-line bg-surface p-4 sm:p-5"
              >
                <div className="min-w-0">
                  <h3 className="text-h3">
                    <Link
                      href={`/courses/${row.course.id}`}
                      className="text-ink-strong underline-offset-4 hover:underline"
                    >
                      {row.course.title}
                    </Link>
                  </h3>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {booking ? (
                      <>
                        <StatusPill tone={TONES[booking.status] ?? 'neutral'}>
                          {BOOKING_STATUS_LABELS[booking.status] ?? booking.status}
                        </StatusPill>
                        {booking.type === 'demo' ? (
                          <StatusPill tone="warning">Trial call</StatusPill>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <StatusPill tone="neutral">Cohort class</StatusPill>
                        {row.mark ? (
                          <StatusPill tone={MARK_TONES[row.mark]}>
                            {ATTENDANCE_STATUS_LABELS[row.mark]}
                          </StatusPill>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex min-w-0 flex-col items-start gap-2">
                  <p className="tabular text-[0.8125rem] text-ink">
                    <Icon name="clock" size="sm" />
                    <span className="ml-1.5">
                      {formatClassWindow(row.startsAt, row.endsAt, timezone)}
                    </span>
                  </p>
                  {booking && standsToLeave(booking) && heading === 'Coming up' ? (
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

                {booking?.live ? (
                  <ClassDoor
                    booking={booking}
                    door={booking.live}
                    timezone={timezone}
                    clock={clock}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The door on one class: when it opens, that it stands open now, and the room behind it.
 *
 * The window arrives with the list; the address never does. A Jitsi room has no password — its name
 * is the whole lock — so the key is asked for at the moment of use, handed to the one student whose
 * name is on the row, and opened inside this page rather than linked to. An `<a>` is a history
 * entry, a hover status line and a prefetch, three copies of an address meant to be used once
 * (ARCHITECTURE §6, §14). "Leave the room" takes it back off the page, and is worded apart from
 * "Leave this class" above it because the two do very different things.
 *
 * The line under the frame is the honest half: the room lives on somebody else's bridge, which has
 * no way to tell this page who is inside it. So the page says what an empty room means rather than
 * letting a student sit in another service's hold screen and read it as a class that never happened.
 */
function ClassDoor({
  booking,
  door,
  timezone,
  clock,
}: {
  booking: Booking;
  door: LiveClassDoor;
  timezone: string | null | undefined;
  clock: number;
}) {
  const [room, setRoom] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const opensAt = Date.parse(door.opensAt);
  const closesAt = Date.parse(door.closesAt);

  // A room belongs to the class it was asked for. A row that re-rendered onto another booking would
  // otherwise leave that address on screen under somebody else's course.
  useEffect(() => {
    setRoom(null);
  }, [booking.id]);

  if (clock < opensAt) {
    return (
      <p className="text-[0.8125rem] text-ink-faint">
        {`Door opens ${formatInstant(door.opensAt, timezone)}`}
      </p>
    );
  }

  if (clock > closesAt) {
    return <p className="text-[0.8125rem] text-ink-faint">Door closed</p>;
  }

  async function join(): Promise<void> {
    setAsking(true);
    try {
      setRoom(await joinRoom(booking.id));
    } catch (error) {
      // The API's reason is the sentence worth reading — the class may have been called off while
      // this page sat open, and a generic fault would send the student back to press it again.
      notify.error(describeFailure(error));
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button type="button" size="sm" loading={asking} onClick={() => void join()}>
          Join
        </Button>
        {room ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setRoom(null)}>
            Leave the room
          </Button>
        ) : null}
      </div>

      {room ? (
        <>
          <p className="text-[0.8125rem] text-ink-muted">
            {`This is the room ${booking.course.title} opened. `}
            An empty one means the teacher has not arrived yet — the class has not failed, and this
            page cannot see inside the room, so wait a few minutes before you call it missed.
          </p>
          <iframe
            src={room}
            // No referrer: the address should not reach the video host's logs as a page URL either.
            referrerPolicy="no-referrer"
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            allowFullScreen
            title={`Live class: ${booking.course.title}`}
            className="aspect-video w-full rounded-card border border-line bg-paper-sunk"
          />
        </>
      ) : null}
    </>
  );
}
