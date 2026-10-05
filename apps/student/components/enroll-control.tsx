'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Skeleton, buttonClass, notify } from '@lms/ui';
import {
  formatMoney,
  type Enrollment,
  type EnrollmentPayment,
  type PlaceResponse,
} from '@lms/shared';

import { NOT_A_LEARNER_MESSAGE, describeFailure, isForbidden } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { heldPlaces, myPlaces, payForPlace, takePlace } from '@/lib/enrollments';

import { useSession } from './session-provider';

/**
 * The one ask on a course page, worded four ways.
 *
 * A stranger is shown the door rather than a button: an enroll request without a session is a
 * `401`, and a control that fails on its first press teaches a visitor that nothing here works.
 * A member outside this course is shown the button. A member whose course costs something is
 * shown the amount, because a press there files a hold rather than opening a door — and claiming
 * they are in the course at that moment would be a promise the outline goes on to refuse. A
 * member already inside is shown the day they came and nothing to press; the API would answer a
 * second press with the same place, so the refusal here is about trust rather than duplicates.
 *
 * Both of this reader's records are read once per course page, in one breath: "am I in this?" and
 * "did I already ask?". The first is the roster of open places, the second the places shut behind
 * money, and neither can be inferred from the outline. Every row of a course whose teacher opened
 * all of them would look exactly like a course this student is inside, and a course they had asked
 * for and not paid for would look exactly like one they never came to.
 *
 * When neither can be read the button stays. `POST /enrollments` is idempotent, and a press on a
 * place that already has an attempt answers with that attempt — same id, same amount — so both
 * writes are safe without the reads; hiding the button would strand a student outside a course they
 * can join because of a failure to *ask* about the thing they came to do. One failure is the
 * exception: a 403 says the session is live and is not a learner's, and the button under it could
 * only answer 403 again, so that reader is shown the account door instead.
 */

/** What the two reads have answered: nothing yet, both lists, or a failure with neither. Which
 * failure it was matters only for the 403 — every other one leaves the button standing. */
type Roster =
  { places: Enrollment[]; held: PlaceResponse[] } | { failed: 'not-a-learner' | 'other' } | null;

/** A place this screen can only render as money owed: the door is shut and an attempt stands
 * against it. Both halves in one object because neither is a complete answer — a closed row with
 * nothing beside it is a place somebody left, and a payment on an open row is a receipt. */
type Hold = { enrollment: Enrollment; payment: EnrollmentPayment };

function asHold(answer: PlaceResponse | null): Hold | null {
  if (!answer || answer.enrollment.isActive || !answer.payment) return null;
  return { enrollment: answer.enrollment, payment: answer.payment };
}

export function EnrollControl({
  courseId,
  onPlaceTaken,
}: {
  courseId: string;
  /** Asks the outline above to read itself again, because `isReadable` is an answer about
   * this reader and this reader has just changed. */
  onPlaceTaken?: () => void;
}) {
  const { status, user } = useSession();
  // The roster belongs to a session as much as to a course: signing in, out, or moving to
  // another course page all make the last answer somebody else's.
  const key = `${status}:${courseId}`;
  const [settled, setSettled] = useState<{ key: string; roster: Roster } | null>(null);
  const [taken, setTaken] = useState<{ key: string; answer: PlaceResponse } | null>(null);
  const [pending, setPending] = useState(false);
  const [paying, setPaying] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const roster = settled && settled.key === key ? settled.roster : null;
  const places = roster && 'places' in roster ? roster.places : null;
  const holds = roster && 'places' in roster ? roster.held : null;
  const lastAnswer = taken && taken.key === key ? taken.answer : null;

  useEffect(() => {
    if (status !== 'signed-in') return;
    let alive = true;

    // One breath for both reads, because they are one question — "what is this student's record
    // with this course" — and a screen that showed the answer to half of it would show a hold as
    // an open door, or an open door as nothing at all.
    Promise.all([myPlaces(), heldPlaces()])
      .then(([items, waits]) => {
        // `settled` rather than the render's `roster`: a failed read has to be retryable, and
        // a flag on the state would be a second source of truth for the same question.
        setSettled((current) => {
          if (!alive || current?.key === key) return current;
          return { key, roster: { places: items, held: waits } };
        });
      })
      .catch((error: unknown) => {
        // A 403 names the session rather than the connection, and the reader can act on it.
        // Every other failure leaves the button standing: the one thing worth knowing about
        // those is that there is no list.
        const reason = isForbidden(error) ? 'not-a-learner' : 'other';
        setSettled((current) =>
          !alive || current?.key === key ? current : { key, roster: { failed: reason } },
        );
      });

    return () => {
      alive = false;
    };
  }, [key, status]);

  if (status === 'unreachable') return null;

  if (status === 'bootstrapping' || (status === 'signed-in' && roster === null)) {
    return (
      <div role="status" aria-label="Checking whether you hold a place" className="mt-4">
        <Skeleton className="h-16 w-full rounded-card" />
      </div>
    );
  }

  // A session that is not a learner's is not a connection that has not come back, and the
  // button under it can only answer 403 again. The door here is the account, not the press.
  if (roster && 'failed' in roster && roster.failed === 'not-a-learner') {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4">
        <p className="max-w-[46ch] text-[0.9375rem] text-ink-muted">{NOT_A_LEARNER_MESSAGE}</p>
        <Link
          href={`/login?next=${encodeURIComponent(`/courses/${courseId}`)}`}
          className={buttonClass({ size: 'sm' })}
        >
          Sign in as a learner
        </Link>
      </div>
    );
  }

  // This tab's own answer is the fresher of the two, so it wins: the read was taken before the press
  // that settled the hold, and a settled row fetched from a stale list would put the money back on a
  // screen whose door has just opened.
  const pressed = asHold(lastAnswer);
  const waiting = (holds ?? []).find((place) => place.enrollment.course.id === courseId);
  // The hold the student arrived with, found on the server rather than remembered here — the reason
  // `GET /enrollments/held` exists at all.
  const held = pressed ?? asHold(waiting ?? null);

  // What the ledger says went wrong, which the read carries as well as the press does: a student
  // who came back to a refused charge should not have to be refused twice to read why.
  const decline =
    held && held.payment.status === 'failed'
      ? (held.payment.error ?? 'That charge did not come through. Press again.')
      : null;

  const inside =
    (lastAnswer?.enrollment.isActive ? lastAnswer.enrollment : null) ??
    (places ?? []).find((place) => place.course.id === courseId) ??
    null;

  async function enroll() {
    setPending(true);
    try {
      const code = couponCode.trim();
      const answer = await (code ? takePlace(courseId, code) : takePlace(courseId));
      setTaken({ key, answer });
      setCouponCode('');
      // Only an opened place is news worth a toast and a re-read. A hold says what it is where
      // the button was, and `isReadable` above has not changed for a place still shut.
      if (answer.enrollment.isActive) {
        notify.success('You are in this course');
        onPlaceTaken?.();
      }
    } catch (error) {
      // The place was not taken, so nothing about this page has changed. A button that
      // disappeared on a refusal would be a lie about the one thing it was for.
      // A 403 says which account would have worked; the API's line only says it did not.
      notify.error(isForbidden(error) ? NOT_A_LEARNER_MESSAGE : describeFailure(error));
    } finally {
      setPending(false);
    }
  }

  async function pay(enrollmentId: string) {
    setPaying(true);
    try {
      const answer = await payForPlace(enrollmentId);
      setTaken({ key, answer });
      if (answer.enrollment.isActive) {
        notify.success('Your place is open');
        // The rows above this one are locked until the money arrives, and the arrival is the
        // reason a student came to this page.
        onPlaceTaken?.();
      }
      // A refusal is an answer with a `200`, not a failed request: the attempt moved to `failed`
      // and the ledger now holds the line worth printing, which the answer above carries.
    } catch (error) {
      // Nothing moved: the hold stands at the same amount and the button has to stay on it.
      notify.error(isForbidden(error) ? NOT_A_LEARNER_MESSAGE : describeFailure(error));
    } finally {
      setPaying(false);
    }
  }

  if (status === 'signed-in' && inside) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-[0.9375rem] text-ink">
          In this course since{' '}
          <span className="tabular">{formatDay(inside.enrolledAt, user?.timezone)}</span>.
        </p>
        <Link
          href="/my-courses"
          className="text-[0.8125rem] text-brand underline-offset-4 hover:underline"
        >
          My courses
        </Link>
      </div>
    );
  }

  // A hold is its own answer, and the only one: the money has not been asked for yet, so this
  // screen says what it will cost and lets the student decide. The amount comes from the ledger
  // row rather than from the shelf, so a coupon that moved the price is the number printed here.
  if (held) {
    const amount = formatMoney({
      minorUnits: held.payment.amountMinorUnits,
      currency: held.payment.currency,
    });

    return (
      <div className="mt-4 space-y-3 rounded-card border border-line bg-surface px-5 py-4">
        <p className="max-w-[46ch] text-[0.9375rem] text-ink">
          Your place is held until the money arrives. This course costs{' '}
          <span className="tabular">{amount}</span>.
        </p>
        {decline && (
          <p role="alert" className="text-[0.8125rem] text-danger">
            {decline}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[46ch] text-[0.8125rem] text-ink-muted">
            Nothing has been charged yet. Reading opens the moment it settles.
          </p>
          <Button
            type="button"
            size="sm"
            loading={paying}
            onClick={() => void pay(held.enrollment.id)}
          >
            Pay {amount}
          </Button>
        </div>
      </div>
    );
  }
  const message =
    status === 'signed-out'
      ? 'Every page on this outline opens once you hold a place in the course.'
      : places === null
        ? 'We could not check whether you already hold one. Enrolling is safe either way — a place taken twice stays one place.'
        : 'Reading starts as soon as you take a place.';

  return (
    <div className="mt-4 space-y-3 rounded-card border border-line bg-surface px-5 py-4">
      {status === 'signed-in' && !inside && (
        <div>
          <label htmlFor="coupon-code" className="block text-sm font-medium text-ink mb-1">
            Have a coupon code?
          </label>
          <input
            id="coupon-code"
            type="text"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[46ch] text-[0.9375rem] text-ink-muted">{message}</p>

        {status === 'signed-out' ? (
          <Link
            href={`/login?next=${encodeURIComponent(`/courses/${courseId}`)}`}
            className={buttonClass({ size: 'sm' })}
          >
            Sign in to enroll
          </Link>
        ) : (
          <Button type="button" size="sm" loading={pending} onClick={() => void enroll()}>
            Enroll in this course
          </Button>
        )}
      </div>
    </div>
  );
}
