'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, ErrorState, Icon, Illo, SkeletonGroup, notify } from '@lms/ui';
import type { Enrollment } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { leavePlace, myPlaces } from '@/lib/enrollments';

import { useSession } from './session-provider';

/**
 * The courses this student is inside, which is the only list on this portal that is somebody's.
 *
 * The API has already filtered it: an open place in a course still on the shelf, and nothing
 * else. So a row here is a link that opens, and the screen adds no filter of its own that
 * could be wrong — a retired course is gone from this list rather than shown with a note,
 * because a note on a page that will not open is a thing to explain and a thing to keep
 * explaining.
 *
 * Leaving is one press, as archiving is for a teacher. It is worth saying what that press
 * costs: nothing that was read is destroyed, and the place can be taken again on the course
 * page — the row the API keeps is the reason the pages already worked through stayed open.
 */

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; places: Enrollment[] }
  | { status: 'failed'; message: string };

export function MyCourses() {
  const router = useRouter();
  const { user } = useSession();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });

    myPlaces()
      .then((items) => {
        if (alive) setState({ status: 'ready', places: items });
      })
      .catch((error: unknown) => {
        if (alive) setState({ status: 'failed', message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [attempt]);

  async function leave(place: Enrollment) {
    setLeavingId(place.id);
    try {
      await leavePlace(place.id);
      // The row goes because the server said so, and it goes from this list rather than being
      // re-fetched: one closed place is not a reason to ask about all the others again.
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', places: current.places.filter((item) => item.id !== place.id) }
          : current,
      );
      notify.success(`No longer in ${place.course.title}`);
    } catch (error) {
      notify.error(describeFailure(error));
    } finally {
      setLeavingId(null);
    }
  }

  if (state.status === 'loading') {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-20 w-full rounded-card"
        label="Loading your courses"
        className="mt-6 flex flex-col gap-3"
      />
    );
  }

  if (state.status === 'failed') {
    return (
      <div className="mt-6">
        <ErrorState
          title="Your courses did not load"
          message={state.message}
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </div>
    );
  }

  if (state.places.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          illustration={<Illo src="/illustrations/peep-sitting-06.svg" size="lg" />}
          title="Nothing you are inside yet"
          description="A course you enroll in appears here, and every page in it opens for you."
          actionLabel="Browse the shelf"
          onAction={() => router.push('/')}
        />
      </div>
    );
  }

  return (
    <ul className="mt-6 flex flex-col gap-3">
      {state.places.map((place) => (
        <li
          key={place.id}
          data-icon-zone
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4 sm:p-5"
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-h3">
              <Link
                href={`/courses/${place.course.id}`}
                className="text-ink-strong underline-offset-4 hover:underline"
              >
                {place.course.title}
              </Link>
            </h2>
            <p className="tabular mt-1 flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-ink-faint">
              <Icon name="clock" size="sm" />
              <span>Since {formatDay(place.enrolledAt, user?.timezone)}</span>
            </p>
          </div>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Leave ${place.course.title}`}
            loading={leavingId === place.id}
            onClick={() => void leave(place)}
          >
            Leave
          </Button>
        </li>
      ))}
    </ul>
  );
}
