'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Illo,
  SkeletonGroup,
  StatusPill,
  notify,
} from '@lms/ui';
import { API_ERROR_CODES, type BookingRequest } from '@lms/shared';

import { ApiError, describeFailure } from '@/lib/api';
import { formatClassWindow } from '@/lib/dates';
import { confirmRequest, listRequests, refuseRequest } from '@/lib/bookings';

import { useSession } from './session-provider';

type Settled = { key: string; requests: BookingRequest[] };
type Answer = 'confirm' | 'refuse';

/**
 * What a teacher has not answered yet.
 *
 * A booking arrives here as `pending` and leaves the moment it is answered, which is why this
 * queue re-reads itself after every decision instead of moving a row out by hand: the row that
 * was confirmed is now a class on the schedule, and the schedule is a different screen's truth.
 *
 * The two answers are not symmetric in what they cost. A yes commits the minute; a no gives it
 * back to the week for somebody else to take. Both are one click, because a teacher who has to
 * open a form to say no will not say it.
 *
 * A refused answer is the interesting failure. Somebody else — the student, or the expiry sweep —
 * can move the row between this screen reading it and the click landing, and the API says so
 * rather than guessing. That refusal arrives as a refresh, because the teacher's read was correct
 * when they made it and only the world underneath has moved.
 */
export function RequestInbox() {
  const { user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pending, setPending] = useState<{ id: string; answer: Answer } | null>(null);
  const [stale, setStale] = useState<string | null>(null);

  const key = String(attempt);

  useEffect(() => {
    let alive = true;

    listRequests()
      .then((requests) => {
        if (alive) setSettled({ key, requests });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key]);

  const requests = settled?.requests ?? [];
  const loading = settled === null;
  const failed = settled?.key !== key && failure?.key === key ? failure : null;
  const refreshing = settled !== null && settled.key !== key;
  const busy = pending !== null || refreshing;
  const zone = user?.timezone ?? 'your own clock';

  function reload() {
    setAttempt((current) => current + 1);
  }

  async function answer(request: BookingRequest, to: Answer) {
    if (busy) return;

    setPending({ id: request.id, answer: to });
    setStale(null);

    let conflict: string | null = null;
    try {
      if (to === 'confirm') await confirmRequest(request.id);
      else await refuseRequest(request.id);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === API_ERROR_CODES.CONFLICT) {
        conflict = describeFailure(error);
      } else {
        notify.error(describeFailure(error));
      }
    }

    setPending(null);
    setStale(conflict);
    // Either the row has moved or the answer did not land; both mean the queue on screen is the
    // wrong one, and re-reading it is the only honest way to find out which.
    reload();
  }

  if (failed) {
    return <ErrorState title="The queue did not load" message={failed.message} onRetry={reload} />;
  }

  if (loading) {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-20 w-full rounded-card"
        label="Loading who is asking"
        className="flex flex-col gap-3"
      />
    );
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
        title="Nobody is asking right now"
        description="A student who books one of your classes lands here first, and waits for you to confirm it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-label text-ink">
        {`${requests.length} waiting for an answer`}
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

      <ul aria-label="Requests waiting for an answer" className="flex flex-col gap-3">
        {requests.map((request) => (
          <li
            key={request.id}
            data-icon-zone
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-line bg-surface p-4 sm:p-5"
          >
            <div className="min-w-0">
              <h3 className="text-h3 text-ink-strong">{request.student.displayName}</h3>
              <p className="mt-0.5 truncate text-[0.8125rem] text-ink-muted">
                {request.course.title}
              </p>
            </div>

            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <p className="tabular text-[0.8125rem] text-ink">
                <Icon name="clock" size="sm" />
                <span className="ml-1.5">
                  {formatClassWindow(request.startsAt, request.endsAt, user?.timezone)}
                </span>
              </p>
              {request.type === 'demo' ? <StatusPill tone="warning">Trial call</StatusPill> : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                loading={pending?.id === request.id && pending.answer === 'confirm'}
                disabled={busy}
                onClick={() => void answer(request, 'confirm')}
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={pending?.id === request.id && pending.answer === 'refuse'}
                disabled={busy}
                onClick={() => void answer(request, 'refuse')}
              >
                Refuse
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
