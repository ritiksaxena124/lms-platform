'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  EmptyState,
  ErrorState,
  Illo,
  SkeletonGroup,
  StatusPill,
  cn,
  notify,
  type StatusTone,
} from '@lms/ui';
import type { Course } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { archiveCourse, listCourses, publishCourse } from '@/lib/courses';

const TABS = [
  { code: 'all', label: 'All' },
  { code: 'draft', label: 'Draft' },
  { code: 'published', label: 'Published' },
  { code: 'archived', label: 'Archived' },
] as const;

type TabCode = (typeof TABS)[number]['code'];

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning',
};

const UPDATED = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Everything this teacher has written, with its lifecycle on the row.
 *
 * One fetch and local tabs: the whole list already arrived, and asking the API again to
 * show the same rows filtered would be a round trip for something a `filter` answers. The
 * order is whatever the API sent — newest first there is a rule with an index behind it,
 * and a portal that re-sorts would be free to disagree with it.
 */
export function CourseList() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [tab, setTab] = useState<TabCode>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);

    listCourses()
      .then((items) => {
        if (alive) setCourses(items);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(describeFailure(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [attempt]);

  async function transition(course: Course, to: 'publish' | 'archive') {
    setPendingId(course.id);
    try {
      const next =
        to === 'publish' ? await publishCourse(course.id) : await archiveCourse(course.id);
      setCourses((current) => current.map((item) => (item.id === next.id ? next : item)));
      notify.success(next.status.label);
    } catch (error) {
      // The row keeps the status it has. A transition the API refused has not happened,
      // and a list that painted the answer anyway teaches a teacher not to trust it.
      notify.error(describeFailure(error));
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return <SkeletonGroup rows={3} rowClassName="h-20 w-full rounded-card" label="Loading courses" />;
  }

  if (loadError) {
    return (
      <ErrorState
        title="Your courses did not load"
        message={loadError}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const visible = tab === 'all' ? courses : courses.filter((course) => course.status.code === tab);

  if (courses.length === 0) {
    return (
      <EmptyState
        illustration={<Illo src="/illustrations/peep-sitting-06.svg" size="lg" />}
        title="Nothing written yet"
        description="A course starts as a title and a level. Everything else can wait until it is worth writing."
        actionLabel="Write your first course"
        onAction={() => router.push('/courses/new')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
        {TABS.map((item) => (
          <button
            key={item.code}
            type="button"
            aria-pressed={tab === item.code}
            onClick={() => setTab(item.code)}
            className={cn(
              'rounded-field border px-3 py-1.5 text-label',
              'transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
              tab === item.code
                ? 'border-brand-line bg-brand-soft font-semibold text-brand-deep'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={`No ${TABS.find((item) => item.code === tab)?.label.toLowerCase()} courses`}
          description="Nothing of this status yet. Choose another tab to see what you have written."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((course) => (
            <li
              key={course.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-h3 text-ink-strong">
                  <Link
                    href={`/courses/${course.id}/edit`}
                    transitionTypes={['nav-forward']}
                    className="text-ink-strong underline-offset-4 hover:underline"
                  >
                    {course.title}
                  </Link>
                </h3>
                <p className="mt-1 truncate text-[0.8125rem] text-ink-faint">
                  /{course.slug} · updated {UPDATED.format(new Date(course.updatedAt))}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] text-ink-muted">{course.level.label}</span>
                  <StatusPill tone={STATUS_TONE[course.status.code] ?? 'neutral'}>
                    {course.status.label}
                  </StatusPill>
                </div>

                {course.status.code === 'draft' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label={`Publish ${course.title}`}
                    loading={pendingId === course.id}
                    onClick={() => void transition(course, 'publish')}
                  >
                    Publish
                  </Button>
                ) : null}

                {course.status.code === 'published' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Archive ${course.title}`}
                    loading={pendingId === course.id}
                    onClick={() => void transition(course, 'archive')}
                  >
                    Archive
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
