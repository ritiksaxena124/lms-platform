'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Skeleton, buttonClass, notify } from '@lms/ui';
import type { Enrollment } from '@lms/shared';

import { describeFailure } from '@/lib/api';
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
 * join because of a failure to *ask* about the thing they came to do.
 */

/** What the roster call has answered: nothing yet, a list, or a failure with no list. */
type Roster = { places: Enrollment[] } | { failed: true } | null;

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
      .catch(() => {
        // Which failure it was makes no difference to what this screen can do: the button
        // stays either way, so the one thing worth knowing is that there is no list.
        setSettled((current) =>
          !alive || current?.key === key ? current : { key, roster: { failed: true } },
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
      notify.error(describeFailure(error));
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
