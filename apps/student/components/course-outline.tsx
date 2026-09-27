'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState, Icon, Illo, SkeletonGroup, buttonClass, cn } from '@lms/ui';
import type { CatalogCourseDetail } from '@lms/shared';

import { describeFailure, isNotFound } from '@/lib/api';
import { readCatalogCourse } from '@/lib/catalog';
import { priceLabel } from '@/lib/price';

import { EnrollControl } from './enroll-control';
import { useSession } from './session-provider';

/**
 * One course as its reader is shown it: what it covers, in the teacher's order, with roughly
 * how long each page takes, and which of them this person may already read.
 *
 * The outline is the whole promise of this screen. A visitor is deciding whether to spend an
 * evening here, and the honest answer is a list of titles in order with a length beside each,
 * not a paragraph of adjectives. So the numbering is printed as the API sent it, gaps and all:
 * a retired module keeps its slot in the syllabus, and renumbering 1 → 4 into 1 → 2 here would
 * be the portal editing somebody else's map.
 *
 * What the outline does not do is hand over a page. A row may be a link — the API says which
 * ones, and a screen that guessed would be wrong for exactly the readers it matters to — and
 * the rest are names, because a screen where every title looked clickable would teach a
 * visitor that none of them are. Two flags travel with each row and only one of them is a link
 * rule: `isReadable` is about the reader, `isFreePreview` is about the page, and a student who
 * holds a place sees the difference on every line.
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
  const { status } = useSession();
  const [settled, setSettled] = useState<{ key: string; state: OutlineState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Two readers, two answers: the same outline arrives with different doors, so the session is
  // part of what a reply is an answer *to*. A key that left it out would keep showing a
  // stranger's syllabus under a student who had just signed in.
  const key = `${courseId}:${attempt}:${status === 'signed-in' ? 'member' : 'visitor'}`;

  useEffect(() => {
    // Until the boot read lands there is no answer to ask for: an outline fetched as a visitor
    // would be re-fetched a moment later, and the first of those is a wasted round trip that
    // paints doors nobody is looking at.
    if (status === 'bootstrapping') return;

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
    // `key` carries `attempt` and which reader this is, and a course id never changes while
    // this screen is open — so these together are the whole request.
  }, [key, courseId, status]);

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
  const lessons = course.modules.flatMap((module) => module.lessons);
  const lessonTotal = lessons.length;
  const minutes = readingMinutes(course);
  const price = priceLabel(course.price);
  // Whether this reader holds a place shows up as every published row being open, which is the
  // only shape of that fact the outline is given. The explainer below is a claim about what
  // they may do, so it has to be read off the rows rather than assumed from a stranger's case.
  const everythingOpens = lessons.every((lesson) => lesson.isReadable);

  return (
    <article>
      <Link href="/" className="text-[0.8125rem] text-brand underline-offset-4 hover:underline">
        All courses
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="eyebrow">{course.level.label}</p>
          {price ? (
            <p className="tabular text-[0.9375rem] font-semibold text-ink-strong">{price}</p>
          ) : null}
        </div>
        <h1 className="mt-2 text-h1 text-ink-strong">{course.title}</h1>
        <p
          data-icon-zone
          className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.9375rem] text-ink-muted"
        >
          <Icon name="user" size="sm" className="text-ink-faint" />
          <span>
            with <span className="text-ink">{course.teacher.displayName}</span>
          </span>
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
        This is the outline: what the course covers, in order, with about how long each page takes.{' '}
        {everythingOpens
          ? 'Every page here is open to you.'
          : 'A title without a link is one you cannot open yet.'}
      </p>

      {/* What to do about a locked title is a different question from what the syllabus holds,
          and it has a different answer for each of the three people who can be looking at it.
          The control below owns that; this paragraph only describes the list. */}
      <EnrollControl courseId={course.id} onPlaceTaken={() => setAttempt((c) => c + 1)} />

      {/* Reading a syllabus and sitting in a class are two different buys of time, and the
          second has a calendar of its own. The door is open to a visitor as much as to a member:
          whether a teacher teaches at hours you can keep is a fact somebody weighs *before*
          enrolling, and the booking screen itself sends a stranger to sign in. */}
      <Link
        href={`/courses/${course.id}/book`}
        data-icon-zone
        className={cn(
          'mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line',
          'bg-surface px-5 py-4 text-[0.9375rem] text-ink',
          'transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
          'hover:border-brand-line hover:bg-brand-soft',
        )}
      >
        <span>Live classes — see the times this teacher keeps open</span>
        <span className="flex items-center gap-1.5 text-[0.8125rem] text-brand">
          Book a class
          <Icon name="arrow-right" size="sm" />
        </span>
      </Link>

      <div className="mt-8 flex flex-col gap-4">
        <h2 className="text-h2 text-ink-strong">Syllabus</h2>
        <ol className="flex flex-col gap-3">
          {course.modules.map((module) => (
            <li key={module.id} className="rounded-card border border-line bg-surface p-5">
              <div className="flex items-start gap-4">
                <span
                  className="tabular mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-field border border-line bg-paper text-[0.8125rem] font-semibold text-ink-muted"
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
                        data-icon-zone
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2 first:border-t-0 first:pt-0"
                      >
                        {/* A page this reader may open is a door, so its title is one. The rest
                            are names, and the link is the row's own state rather than a guess
                            from where it sits in the list. */}
                        {lesson.isReadable ? (
                          <Link
                            href={`/courses/${course.id}/lessons/${lesson.id}`}
                            className="inline-flex items-start gap-1.5 text-[0.9375rem] font-medium text-brand underline-offset-4 hover:underline"
                          >
                            {lesson.title}
                            <Icon name="arrow-right" size="sm" className="mt-1 text-ink-faint" />
                          </Link>
                        ) : (
                          <span className="text-[0.9375rem] text-ink">{lesson.title}</span>
                        )}
                        <span className="flex items-center gap-3">
                          {lesson.estimatedMinutes === null ? (
                            <span className="text-[0.8125rem] text-ink-faint">Not timed</span>
                          ) : (
                            <span className="tabular inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-faint">
                              <Icon name="clock" size="sm" />
                              {lesson.estimatedMinutes} min
                            </span>
                          )}
                          {/* Which of the states a row is in, said in words as well as in a
                              shape — the two glyphs are the same silhouette at a glance, and a
                              colour pair alone is not an answer for anybody. A row this reader
                              holds a place in carries no glyph at all: it is open, and saying so
                              on every line would be noise, while a lock on a page somebody can
                              open is a lie. */}
                          {lesson.isFreePreview ? (
                            <Icon
                              name="unlock"
                              size="sm"
                              label="Free to read"
                              className="text-brand"
                            />
                          ) : lesson.isReadable ? null : (
                            <Icon
                              name="lock"
                              size="sm"
                              label="Behind enrollment"
                              className="text-ink-faint"
                            />
                          )}
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
