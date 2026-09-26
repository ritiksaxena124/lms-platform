'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EmptyState,
  ErrorState,
  Illo,
  SkeletonGroup,
  buttonClass,
  cn,
} from '@lms/ui';
import type { CatalogCourseDetail } from '@lms/shared';

import { describeFailure, isNotFound } from '@/lib/api';
import { readCatalogCourse } from '@/lib/catalog';

/**
 * One course as a stranger reads it: what it covers, in the teacher's order, with roughly how
 * long each page takes — and no page.
 *
 * The outline is the whole promise of this screen. A visitor is deciding whether to spend an
 * evening here, and the honest answer is a list of titles in order with a length beside each,
 * not a paragraph of adjectives. So the numbering is printed as the API sent it, gaps and all:
 * a retired module keeps its slot in the syllabus, and renumbering 1 → 4 into 1 → 2 here would
 * be the portal editing somebody else's map.
 *
 * What is deliberately missing is any door into a lesson. There is no such route yet, and a
 * title that looked clickable would teach a visitor not to trust the ones that are.
 */

const UPDATED = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** The minutes a teacher guessed at, added up. `null` means they did not guess, which is not
 * the same as a page that takes no time — so an outline with no estimates says nothing. */
function readingMinutes(course: CatalogCourseDetail): number {
  return course.modules.reduce(
    (total, module) =>
      total + module.lessons.reduce((sum, lesson) => sum + (lesson.estimatedMinutes ?? 0), 0),
    0,
  );
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

/** Where this screen is between the request and its answer. One value rather than three
 * booleans, because three flags can agree to disagree — and a 500 that reads as "not found"
 * tells a visitor the course is gone when all that broke is the connection. */
type OutlineState =
  | { status: 'loading' }
  | { status: 'ready'; course: CatalogCourseDetail }
  | { status: 'not-found' }
  | { status: 'failed'; message: string };

export function CourseOutline({ courseId }: { courseId: string }) {
  const [settled, setSettled] = useState<{ key: string; state: OutlineState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${courseId}:${attempt}`;

  useEffect(() => {
    let alive = true;

    readCatalogCourse(courseId)
      .then((found) => {
        if (alive) setSettled({ key, state: { status: 'ready', course: found } });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // "Not published", "retired" and "never existed" are one answer from the API, and
        // one answer is what the screen says. Anything more would be inventing a
        // distinction to leak.
        if (isNotFound(error)) setSettled({ key, state: { status: 'not-found' } });
        else setSettled({ key, state: { status: 'failed', message: describeFailure(error) } });
      });

    return () => {
      alive = false;
    };
    // `key` carries `attempt`, and a course id never changes while this screen is open — so
    // these two together are the whole request.
  }, [key, courseId]);

  // Loading is derived from that pairing: an answer tagged with some earlier key has not
  // arrived yet, so the skeleton stays up instead of showing a stale course under a new url.
  const state: OutlineState =
    settled && settled.key === key ? settled.state : { status: 'loading' };

  if (state.status === 'loading') {
    return (
      <SkeletonGroup
        rows={5}
        rowClassName="h-24 w-full rounded-card"
        label="Loading this course"
        className="flex flex-col gap-4"
      />
    );
  }

  if (state.status === 'not-found') {
    return (
      <div>
        <Link href="/" className="text-[0.8125rem] text-brand underline-offset-4 hover:underline">
          All courses
        </Link>
        <EmptyState
          className="mt-4"
          illustration={<Illo src="/illustrations/peep-standing-01.svg" size="lg" />}
          title="This course is not on the shelf"
          description="A course appears here only while a teacher has it published. This one is not, or the link has a mistake in it."
        />
      </div>
    );
  }

  if (state.status === 'failed') {
    return (
      <ErrorState
        title="This course did not load"
        message={state.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const course = state.course;
  const lessonTotal = course.modules.reduce((sum, module) => sum + module.lessons.length, 0);
  const minutes = readingMinutes(course);

  return (
    <article>
      <Link href="/" className="text-[0.8125rem] text-brand underline-offset-4 hover:underline">
        All courses
      </Link>

      <header className="mt-3">
        <p className="eyebrow">{course.level.label}</p>
        <h1 className="mt-2 text-h1 text-ink-strong">{course.title}</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-muted">
          with <span className="text-ink">{course.teacher.displayName}</span>
        </p>
        <p className="tabular mt-4 flex flex-wrap gap-x-2 gap-y-1 text-[0.8125rem] text-ink-faint">
          <span>{plural(course.modules.length, 'module')}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(lessonTotal, 'lesson')}</span>
          {minutes > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>about {minutes} min of reading</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span>updated {UPDATED.format(new Date(course.updatedAt))}</span>
        </p>
      </header>

      {course.summary ? (
        <p className="mt-6 max-w-[52ch] text-h2 text-ink-strong">{course.summary}</p>
      ) : null}
      {course.description ? (
        <p
          data-description
          className="mt-3 max-w-[60ch] whitespace-pre-wrap text-[0.9375rem] leading-[1.65] text-ink-muted"
        >
          {course.description}
        </p>
      ) : null}

      <p
        className={cn(
          'mt-8 max-w-[60ch] rounded-card border border-brand-line bg-brand-wash px-5 py-4',
          'text-[0.9375rem] text-ink',
        )}
      >
        This is the outline: what the course covers, in order, with about how long each page
        takes. Reading the pages is what enrolling is for.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <h2 className="text-h2 text-ink-strong">Syllabus</h2>
        <ol className="flex flex-col gap-3">
          {course.modules.map((module) => (
            <li
              key={module.id}
              className="rounded-card border border-line bg-surface p-5"
            >
              <div className="flex items-start gap-4">
                <span
                  className="tabular mt-0.5 w-6 shrink-0 text-[0.8125rem] font-semibold text-ink-faint"
                  title={`Module ${module.position}`}
                >
                  {module.position}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-h3 text-ink-strong">{module.title}</h3>
                  {module.summary ? (
                    <p className="mt-1 text-[0.875rem] text-ink-muted">{module.summary}</p>
                  ) : null}

                  <ol className="mt-3 flex flex-col">
                    {module.lessons.map((lesson) => (
                      <li
                        key={lesson.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2 first:border-t-0 first:pt-0"
                      >
                        <span className="text-[0.9375rem] text-ink">{lesson.title}</span>
                        <span className="tabular text-[0.8125rem] text-ink-faint">
                          {lesson.estimatedMinutes === null
                            ? 'Not timed'
                            : `${lesson.estimatedMinutes} min`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-8 border-t border-line pt-6">
        <Link href="/" className={buttonClass({ variant: 'secondary' })}>
          Browse other courses
        </Link>
      </div>
    </article>
  );
}
