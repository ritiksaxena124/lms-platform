'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Skeleton, buttonClass, notify } from '@lms/ui';
import type { Enrollment } from '@lms/shared';

import { NOT_A_LEARNER_MESSAGE, describeFailure, isForbidden } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { myPlaces, takePlace } from '@/lib/enrollments';

import { useSession } from './session-provider';

/**
 * The one ask on a course page, worded three ways.
 *
 * A stranger is shown the door rather than a button: an enroll request without a session is a
 * `401`, and a control that fails on its first press teaches a visitor that nothing here works.
 * A member outside this course is shown the button. A member already inside is shown the day
 * they came and nothing to press — the API would answer a second press with the same place, so
 * the refusal here is about trust rather than about duplicates.
 *
 * The roster is read once per course page because "am I in this?" is not something the outline
 * can infer. Every row of a course whose teacher opened all of them would look exactly like a
 * course this student is inside, and a screen that guessed would offer enrollment to somebody
 * holding a place.
 *
 * When the roster cannot be read the button stays. `POST /enrollments` is idempotent, so the
 * write is safe without the read; hiding it would strand a student outside a course they can
 * join because of a failure to *ask* about the thing they came to do. One failure is the
 * exception: a 403 says the session is live and is not a learner's, and the button under it
 * could only answer 403 again, so that reader is shown the account door instead.
 */

/** What the roster call has answered: nothing yet, a list, or a failure with no list. Which
 * failure it was matters only for the 403 — every other one leaves the button standing. */
type Roster = { places: Enrollment[] } | { failed: 'not-a-learner' | 'other' } | null;

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
  const [taken, setTaken] = useState<{ key: string; place: Enrollment } | null>(null);
  const [pending, setPending] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const roster = settled && settled.key === key ? settled.roster : null;
  const places = roster && 'places' in roster ? roster.places : null;

  useEffect(() => {
    if (status !== 'signed-in') return;
    let alive = true;

    myPlaces()
      .then((items) => {
        // `settled` rather than the render's `roster`: a failed read has to be retryable, and
        // a flag on the state would be a second source of truth for the same question.
        setSettled((current) => {
          if (!alive || current?.key === key) return current;
          return { key, roster: { places: items } };
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

  const inside =
    taken?.key === key
      ? taken.place
      : ((places ?? []).find((place) => place.course.id === courseId) ?? null);

  async function enroll() {
    setPending(true);
    try {
      const code = couponCode.trim();
      const place = await (code ? takePlace(courseId, code) : takePlace(courseId));
      setTaken({ key, place });
      notify.success('You are in this course');
      setCouponCode(''); // Clear coupon after successful enrollment
      onPlaceTaken?.();
    } catch (error) {
      // The place was not taken, so nothing about this page has changed. A button that
      // disappeared on a refusal would be a lie about the one thing it was for.
      // A 403 says which account would have worked; the API's line only says it did not.
      notify.error(isForbidden(error) ? NOT_A_LEARNER_MESSAGE : describeFailure(error));
    } finally {
      setPending(false);
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
