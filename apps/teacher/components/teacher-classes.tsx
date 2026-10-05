'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  BOOKING_MARK_CODES,
  BOOKING_STATUS_CODES,
  BOOKING_STATUS_LABELS,
  type BookingMarkCode,
  type BookingRequest,
  type BookingStatusCode,
  type LiveClassDoor,
} from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { joinRoom, listClasses, markClass } from '@/lib/bookings';
import { formatClassWindow, formatInstant } from '@/lib/dates';

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
  return Date.parse(booking.startsAt) > now;
}

/** The two words that end a class, in the order a teacher reaches for them.
 *
 * Screen-local wording, deliberately: `BOOKING_STATUS_LABELS` says what a row *is* — "Completed",
 * "No show" — and both portals read that from the API. These are verbs on a button, and "Mark
 * taught" is the thing a person is doing. */
const MARKS: { code: BookingMarkCode; word: string; said: string }[] = [
  { code: BOOKING_MARK_CODES.COMPLETED, word: 'Mark taught', said: 'Marked taught' },
  { code: BOOKING_MARK_CODES.NO_SHOW, word: 'Mark missed', said: 'Marked missed' },
];

/** A confirmed class whose first minute has arrived is the only row with a mark left to give.
 *
 * Judged on the start and not the end, because a teacher who ran a short lesson, or sat in an empty
 * room and gave up on it, knows how it finished before the clock does. This is courtesy rather than
 * the rule — the route refuses the same presses again on the server's clock, and a row that went
 * stale while the page stood open is corrected by the re-read the press ends with. */
function isMarkable(booking: BookingRequest, clock: number): boolean {
  return booking.status === BOOKING_STATUS_CODES.CONFIRMED && Date.parse(booking.startsAt) <= clock;
}

/**
 * The teacher's classes, in the order they happen.
 *
 * The API hands back every booking that ever held this teacher's minute — waiting, confirmed,
 * cancelled, refused, expired — because the list *is* the schedule and a schedule keeps what
 * happened on it. The screen groups those by date and lets the pill say what each one is, so a
 * class refuses to be in two places at once: the lesson you said no to on Monday still sits where
 * Monday is, next to the word that explains why you are not teaching it.
 *
 * Splitting on anything else breaks in both directions. On the status alone, a confirmed class
 * stays "coming up" until somebody marks it off, and a teacher who meant to press the word after
 * Thursday and never did would keep seeing a class from last week as one still to prepare for; on
 * whether the minute is still held, a refused request that was never going to happen moves out of
 * the week it belongs to. The date is the one fact here that does not change when somebody answers.
 *
 * The instant the split is made against arrives with the read rather than being taken while
 * rendering: a clock in the render body gives the server one schedule and the browser another,
 * and a lesson that is upcoming on only one of those two is a hydration mismatch.
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
  /**
   * The door's clock, which moves while the page is open.
   *
   * `settled.now` stays the instant the list arrived, because which half of the schedule a class
   * belongs to was decided against the read that drew it. A door is a different question: it opens
   * while a teacher is looking for it, and a row that froze its verdict at page-load would tell
   * them to arrive five minutes late to a class they could have joined.
   */
  const [doorTick, setDoorTick] = useState(0);

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

  useEffect(() => {
    const every = setInterval(() => setDoorTick(Date.now()), 30_000);
    return () => {
      clearInterval(every);
    };
  }, []);

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
  const doorClock = Math.max(now, doorTick);

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
        clock={doorClock}
        onMarked={reload}
        empty="Nothing is waiting to happen yet."
      />
      {earlier.length > 0 ? (
        <Section
          heading="Earlier"
          bookings={earlier}
          timezone={user?.timezone}
          clock={doorClock}
          onMarked={reload}
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
  clock,
  onMarked,
  empty,
}: {
  heading: string;
  bookings: BookingRequest[];
  timezone: string | null | undefined;
  /** The instant the doors are judged against, which moves while the page stands open. */
  clock: number;
  /** Called after a mark is pressed, whichever way the press went, so the word on the row is read
   * back from the table rather than left as the one a button was labelled with. */
  onMarked: () => void;
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
              data-tour="class-card"
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
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
                    {booking.type === 'demo' ? (
                      <StatusPill tone="warning">Trial call</StatusPill>
                    ) : null}
                  </div>
                </div>
              </div>

              {booking.live ? (
                <ClassDoor
                  booking={booking}
                  door={booking.live}
                  timezone={timezone}
                  clock={clock}
                />
              ) : null}

              {isMarkable(booking, clock) ? (
                <ClassMark booking={booking} onMarked={onMarked} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The door on one class: when it opens, that it stands open now, and the room behind it.
 *
 * The window arrives with the list; the address never does. A Jitsi room has no password — its
 * name is the whole lock — so the key is asked for at the moment of use, handed to one checked
 * person, and opened in this page rather than linked to: an `<a>` is a history entry, a prefetch
 * and a status line, all of which keep an address that was only ever meant to be used once
 * (ARCHITECTURE §6, §14). Leaving takes it back off the page.
 */
function ClassDoor({
  booking,
  door,
  timezone,
  clock,
}: {
  booking: BookingRequest;
  door: LiveClassDoor;
  timezone: string | null | undefined;
  clock: number;
}) {
  const [room, setRoom] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const opensAt = Date.parse(door.opensAt);
  const closesAt = Date.parse(door.closesAt);

  // A room belongs to the class it was asked for. A row that re-rendered onto another booking
  // would otherwise leave that address on screen under somebody else's name.
  useEffect(() => {
    setRoom(null);
  }, [booking.id]);

  if (clock < opensAt) {
    return (
      <p className="flex items-center gap-1.5 text-[0.8125rem] text-ink-faint">
        <Icon name="clock" size="sm" />
        {`Opens ${formatInstant(door.opensAt, timezone)}`}
      </p>
    );
  }

  if (clock > closesAt) {
    return (
      <p className="flex items-center gap-1.5 text-[0.8125rem] text-ink-faint">
        <Icon name="video-camera" size="sm" />
        Door closed
      </p>
    );
  }

  async function join(): Promise<void> {
    setAsking(true);
    try {
      setRoom(await joinRoom(booking.id));
    } catch (error) {
      // The API's reason is the sentence worth reading — the class may have been cancelled while
      // this page sat open, and a generic fault would send the teacher back to press again.
      notify.error(describeFailure(error));
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      {!room ? (
        <div className="flex flex-col gap-2 rounded-field border border-brand-soft bg-brand-soft p-3">
          <div className="flex items-center gap-2">
            <Icon name="video-camera" size="md" className="text-brand-deep" />
            <span className="text-label font-semibold text-brand-deep">Live class is open</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={asking}
            onClick={() => void join()}
            data-tour="join-button"
            className="w-full justify-center"
          >
            Join video call
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" variant="ghost" onClick={() => setRoom(null)} data-tour="leave-room">
              Leave the room
            </Button>
          </div>
          <iframe
            src={room}
            // No referrer: the address should not reach the video host's logs as a page URL either.
            referrerPolicy="no-referrer"
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            allowFullScreen
            title={`Live class with ${booking.student.displayName}`}
            data-tour="video-frame"
            className="aspect-video w-full rounded-card border border-line bg-paper-sunk"
          />
        </>
      )}
    </>
  );
}

/**
 * The word a class ends on.
 *
 * Two buttons, because there are two things that can be true of a class that has gone by and a
 * teacher is the only person who knows which. Pressing one is the smallest decision on this screen
 * — one row, one word, nothing to type — so it goes where the class already is rather than on a
 * roll page of its own: a one-to-one has one name, and that name is the class.
 *
 * The row is re-read whichever way the press went, success or refusal. What a class says afterwards
 * is what the table answered, and a 409 here means the row this page drew was not the class any
 * more — somebody cancelled it, or it was marked from another tab — so the same fetch that shows
 * the new word is what shows the reason the old one was refused.
 */
function ClassMark({ booking, onMarked }: { booking: BookingRequest; onMarked: () => void }) {
  const [pressed, setPressed] = useState<BookingMarkCode | null>(null);

  const busy = pressed !== null;

  async function mark(code: BookingMarkCode, said: string): Promise<void> {
    setPressed(code);
    try {
      await markClass(booking.id, code);
      notify.success(said);
    } catch (error) {
      // The API's sentence is the one worth reading: it says which of the four refusals this class
      // got, and the difference between them is a fact about the teacher's own week.
      notify.error(describeFailure(error));
    } finally {
      setPressed(null);
      onMarked();
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {MARKS.map((word) => (
        <Button
          key={word.code}
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          loading={pressed === word.code}
          onClick={() => void mark(word.code, word.said)}
        >
          {word.word}
        </Button>
      ))}
    </div>
  );
}
