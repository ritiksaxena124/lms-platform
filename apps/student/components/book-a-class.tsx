'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Calendar,
  EmptyState,
  ErrorState,
  Icon,
  Illo,
  SkeletonGroup,
  notify,
} from '@lms/ui';
import {
  API_ERROR_CODES,
  BOOKING_HORIZON_DAYS,
  BOOKING_STATUS_CODES,
  SLOT_DENIAL_CODES,
  SLOT_ENTITLEMENT_CODES,
  formatInZone,
  shortZoneLabel,
  type Booking,
  type OpenSlotsResponse,
} from '@lms/shared';

import { ApiError, describeFailure } from '@/lib/api';
import { bookSlot, myBookings, openSlotsFor } from '@/lib/bookings';
import { buildSlotWeeks } from '@/lib/slot-week';

import { useSession } from './session-provider';

/**
 * The teacher's week, offered to one student.
 *
 * A booking here is a request, not a place: the press sends a minute the teacher has to say yes
 * to, so nothing on this screen claims a class has happened. And the reason a student cannot book
 * is a fact about their relationship to the course, which the API states as an entitlement — a
 * screen that inferred it from an empty calendar would tell somebody to enroll in the course they
 * are already inside.
 *
 * The grid is drawn in the teacher's clock and says so above itself, because the minutes were cut
 * from their week. The student's own zone appears once, beside the pick, for the one thing it
 * decides: whether they will be awake for it.
 */

interface Settled {
  key: string;
  /** The offer as the API made it: the grid, the zone it is read in, and the entitlement. */
  offer: OpenSlotsResponse;
  /** All of this student's classes; the grid keeps only the ones holding a minute here. */
  bookings: Booking[];
  /** Stamped when the read landed. The grid's "today" is a claim about the reading, and a clock
   * read during render is one instant on the server and another in the browser. */
  now: number;
}

export function BookAClass({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { status, user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [week, setWeek] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState<string | null>(null);

  // The offer belongs to a session as much as to a course: signing in, signing out, or trying
  // again all make the last answer somebody else's, or somebody later's.
  const key = `${status}:${courseId}:${attempt}`;

  useEffect(() => {
    // A stranger cannot be offered a class, and a boot read that has not landed yet would be
    // fetched twice over — the session provider is about to say who is here.
    if (status !== 'signed-in') return;

    let alive = true;

    Promise.all([openSlotsFor(courseId), myBookings()])
      .then(([offer, bookings]) => {
        if (alive) setSettled({ key, offer, bookings, now: Date.now() });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key, status, courseId]);

  const data = settled && settled.key === key ? settled : null;
  const failed = settled?.key !== key && failure?.key === key ? failure : null;

  function reload() {
    setAttempt((current) => current + 1);
  }

  function pick(startsAt: string) {
    setSelected(startsAt);
    setStale(null);
  }

  async function request(startsAt: string) {
    if (pending) return;

    setPending(true);
    setStale(null);
    try {
      const booking = await bookSlot(courseId, startsAt);
      // Merged rather than re-read: the minute the server offered a moment ago is now this
      // student's own, and the grid draws it as pending instead of as an open chip.
      setSettled((current) =>
        current && current.key === key
          ? { ...current, bookings: [...current.bookings, booking] }
          : current,
      );
      setSelected(null);
      notify.success('Sent to the teacher, who confirms it');
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === API_ERROR_CODES.CONFLICT) {
        // Either somebody else took the minute or the entitlement moved. The read on screen is
        // the wrong one now, so it is said plainly and asked again.
        setSelected(null);
        setStale(describeFailure(error));
        reload();
      } else {
        notify.error(describeFailure(error));
      }
    } finally {
      setPending(false);
    }
  }

  if (failed) {
    return (
      <ErrorState
        title="The teacher's calendar did not load"
        message={failed.message}
        onRetry={reload}
      />
    );
  }

  // The page this screen sits on is gated by `RequireSession`, so a visitor never reaches the
  // calendar at all; the effect still waits for the same answer, because an offer fetched for a
  // stranger is a fetch that will be thrown away when the session lands.
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonGroup
          rows={1}
          rowClassName="h-8 w-full rounded-field"
          label="Checking whether you may book"
        />
        <SkeletonGroup
          rows={1}
          rowClassName="h-80 w-full rounded-card"
          label="Loading the teacher's week"
        />
      </div>
    );
  }

  const offer = data.offer;
  const zone = offer.teacher.timezone;

  if (offer.entitlement === SLOT_ENTITLEMENT_CODES.NONE) {
    const triedAlready = offer.denial === SLOT_DENIAL_CODES.DEMO_ALREADY_TAKEN;
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-standing-19.svg" size="lg" />}
        title={triedAlready ? 'You have had this course trial call' : 'Classes are for students of the course'}
        description={
          triedAlready
            ? 'One trial class per course, and yours is done. Hold a place here and the whole calendar opens.'
            : 'This teacher has not opened the course to trial calls, so its classes go to the students inside it. Enroll and the calendar is yours.'
        }
        actionLabel="Go to the course"
        onAction={() => router.push(`/courses/${courseId}`)}
      />
    );
  }

  const weeks = buildSlotWeeks(offer, data.bookings, data.now, { selected, onSelect: pick });
  const index = Math.min(week, weeks.length - 1);
  const current = weeks[index];
  const mine = data.bookings.filter(
    (booking) =>
      booking.course.id === offer.course.id &&
      (booking.status === BOOKING_STATUS_CODES.PENDING ||
        booking.status === BOOKING_STATUS_CODES.CONFIRMED),
  );

  if (!current || (offer.slots.length === 0 && mine.length === 0)) {
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-sitting-17.svg" size="lg" />}
        title="No class to take right now"
        description={`Either this teacher keeps no open windows, has marked off every day ahead of you, or has had every minute in the next ${BOOKING_HORIZON_DAYS} days held by somebody else. Ask them for a time, or check back after they update their availability.`}
      />
    );
  }

  // A pick only shows if it is still on the offer: a minute taken in the last few seconds has no
  // box to confirm, and one that is already the student's has nothing left to ask.
  const picked = selected ? (offer.slots.find((slot) => slot.startsAt === selected) ?? null) : null;
  const ownZone = user?.timezone && user.timezone !== zone ? user.timezone : null;

  // A minute the student holds is not an open class, however the offer counted it: the read was
  // made before the press that took it, and a line that still offered it would be a number the
  // grid below contradicts.
  const heldMinutes = new Set(mine.map((booking) => booking.startsAt));
  const openCount = offer.slots.filter((slot) => !heldMinutes.has(slot.startsAt)).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-label text-ink">
        {`${openCount} ${openCount === 1 ? 'open class' : 'open classes'}`}
        <span className="text-ink-faint">{` in the next ${BOOKING_HORIZON_DAYS} days`}</span>
      </p>

      {offer.entitlement === SLOT_ENTITLEMENT_CODES.DEMO ? (
        <p className="max-w-[60ch] rounded-card border border-brand-line bg-brand-wash px-5 py-4 text-[0.9375rem] text-ink">
          You are not in this course yet, so this is a trial call — one class, and the teacher
          confirms it before it happens.
        </p>
      ) : null}

      {stale ? (
        <p
          role="status"
          className="max-w-[60ch] rounded-field border border-warning-soft bg-warning-soft px-3 py-2 text-[0.8125rem] text-warning"
        >
          {stale}
        </p>
      ) : null}

      <Calendar
        days={current.days}
        label={current.label}
        caption={`Times are the teacher's clock: ${zone} (${shortZoneLabel(offer.from, zone)})`}
        onPrevious={() => setWeek((current2) => Math.max(0, current2 - 1))}
        onNext={() => setWeek((current2) => Math.min(weeks.length - 1, current2 + 1))}
        previousDisabled={index === 0}
        nextDisabled={index === weeks.length - 1}
        busy={pending}
      />

      {picked ? (
        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <p className="eyebrow">You picked</p>
          <p
            data-icon-zone
            className="tabular mt-2 flex flex-wrap items-center gap-1.5 text-h3 text-ink-strong"
          >
            <Icon name="clock" size="sm" className="text-ink-faint" />
            <span>{formatInZone(picked.startsAt, zone).label}</span>
          </p>
          {ownZone ? (
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              {`Which is ${formatInZone(picked.startsAt, ownZone).label} where you are.`}
            </p>
          ) : null}
          <p className="mt-3 max-w-[56ch] text-[0.875rem] text-ink-muted">
            Nothing is booked yet. This sends the teacher a request, and the class stands only once
            they confirm it.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" loading={pending} onClick={() => void request(picked.startsAt)}>
              Request this class
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setSelected(null)}>
              Leave it
            </Button>
          </div>
        </div>
      ) : (
        <p className="max-w-[60ch] text-[0.875rem] text-ink-faint">
          Pick a time above to send it to the teacher. Anything you have already asked for stays on
          the grid until they answer, and your classes are on your shelf.
        </p>
      )}
    </div>
  );
}
