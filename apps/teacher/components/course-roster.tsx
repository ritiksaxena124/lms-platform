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
  type StatusTone,
} from '@lms/ui';
import type { Course, CourseRosterResponse } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { readCourse } from '@/lib/courses';
import { courseRoster } from '@/lib/roster';

import { useSession } from './session-provider';

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
};

type Settled = { key: string; course: Course; roster: CourseRosterResponse };

/**
 * Who holds a place in one course, newest first.
 *
 * The API answers for whoever the session belongs to, so the only course whose roster can be
 * read here is one this teacher wrote — and the course travels with the roster because the
 * status is what tells a teacher whether there is anything for a student to enroll in.
 *
 * Nothing on this screen changes a row. Leaving is the student's decision (§12), so a roster is
 * read rather than managed: no checkbox, no remove button, and no field the API did not send —
 * a name and a day are all a class list needs to be recognisable.
 *
 * "Loading" is derived rather than stored: a page carries the request it answers for, and a
 * result whose page has gone is no result. Turning that into a `status` field would mean
 * resetting the field when the page changes, which is a second render for something the render
 * can already see.
 */
export function CourseRoster({ courseId }: { courseId: string }) {
  const { user } = useSession();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const key = `${courseId}:${page}:${attempt}`;

  useEffect(() => {
    let alive = true;

    Promise.all([readCourse(courseId), courseRoster(courseId, page)])
      .then(([course, roster]) => {
        if (alive) setSettled({ key, course, roster });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key, courseId, page]);

  if (settled?.key !== key && failure?.key === key) {
    return (
      <ErrorState
        title="The roster did not load"
        message={failure.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  if (settled?.key !== key) {
    return (
      <SkeletonGroup
        rows={3}
        rowClassName="h-16 w-full rounded-card"
        label="Loading the roster"
        className="flex flex-col gap-3"
      />
    );
  }

  const { course, roster } = settled;
  const lastPage = Math.max(1, Math.ceil(roster.total / roster.pageSize));
  const paged = roster.total > roster.pageSize;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[0.8125rem] text-ink-muted">{course.title}</span>
          <StatusPill tone={STATUS_TONE[course.status.code] ?? 'neutral'}>
            {course.status.label}
          </StatusPill>
        </div>
      </div>

      <p className="text-label text-ink">
        {`${roster.total} on the roster`}
        {roster.items.length > 0 ? <span className="text-ink-faint"> · newest first</span> : null}
      </p>

      {roster.items.length === 0 ? (
        <EmptyState
          illustration={<Illo src="/illustrations/peep-standing-11.svg" size="lg" />}
          title="Nobody has taken a place yet"
          description="A student who enrolls in this course appears here, with the day their place opened."
        />
      ) : (
        <ul aria-label="Roster" className="flex flex-col gap-3">
          {roster.items.map((entry) => (
            <li
              key={entry.student.id}
              data-icon-zone
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <div className="min-w-0">
                <h3 className="text-h3 text-ink-strong">{entry.student.fullName}</h3>
              </div>
              <p className="tabular text-[0.8125rem] text-ink-faint">
                <Icon name="clock" size="sm" />
                <span className="ml-1.5">{`Enrolled ${formatDay(entry.enrolledAt, user?.timezone)}`}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {paged ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <span className="tabular text-[0.8125rem] text-ink-muted">{`Page ${roster.page} of ${lastPage}`}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Next page"
            disabled={page >= lastPage}
            onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
