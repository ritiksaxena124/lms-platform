'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState, Icon, Illo, SkeletonGroup, buttonClass, cn } from '@lms/ui';
import type { CatalogCourseDetail, CatalogLesson, CatalogLessonPage } from '@lms/shared';

import { describeFailure, isNotFound } from '@/lib/api';
import { readCatalogCourse, readLessonPage } from '@/lib/catalog';
import { LessonPlayer } from './lesson-player';
import { useSession } from './session-provider';

/**
 * One page of a course, read by whoever the catalog agreed to hand it to — a visitor through a
 * door the teacher left open, or a student who holds a place.
 *
 * The address is a pair, and it is used as one: the lesson id alone would be a page floating
 * free of the syllabus that gives it its number, so the course in the path is what answers.
 * That is also why a refusal here is the whole story. The API does not distinguish "locked",
 * "withdrawn" and "never written", and neither may this screen: a message that did would be a
 * list of pages worth enrolling for.
 *
 * What the two readers may not be told apart about is the door. Everything else on this page —
 * the module it sits in, the estimate beside it, the way back to the outline — is the same text,
 * because it is the same page. Only the sentence that says how the reader got in changes.
 *
 * The body is markdown and is shown as written — line breaks kept, no renderer. Teaching text
 * survives that honestly; inventing a parser here would be a decision about the editor, which
 * is a later step's business.
 *
 * A recording is offered by the page itself, because the response that carried the text also
 * named the file and said how long it is. That is what lets this screen decide whether to draw a
 * player without asking a second question of the API — and a student who cannot be told whether a
 * lesson was filmed is a student who has to press a button to find out.
 *
 * Where to go next, though, the page cannot say: it knows its own number and no neighbour. So
 * the syllabus is read once per course — the same outline read the course screen already makes,
 * with the same doors — and the pager is cut from it. That is why the walk is by position rather
 * than by array order, and why a row this reader may not open stays a name: the outline prints
 * locked titles exactly this way, so the pager repeats a distinction the API already published
 * instead of inventing one here.
 */

const UPDATED = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; lesson: CatalogLessonPage }
  | { status: 'not-found' }
  | { status: 'failed'; message: string };

/** The syllabus as a walk: every page of every module in the order the reader is meant to go
 * through them. The two numbers the header prints are the two numbers sorted on, so "the page
 * before this one" means the same thing here as it does on the outline. */
function walkingOrder(course: CatalogCourseDetail): CatalogLesson[] {
  return [...course.modules]
    .sort((first, second) => first.position - second.position)
    .flatMap((module) =>
      [...module.lessons].sort((first, second) => first.position - second.position),
    );
}

/** The neighbours of one row, or `null` when there is nothing on either side worth saying. */
function neighbours(
  rows: CatalogLesson[],
  lessonId: string,
): { previous: CatalogLesson | null; next: CatalogLesson | null } | null {
  const at = rows.findIndex((row) => row.id === lessonId);
  if (at === -1) return null;

  const previous = rows[at - 1] ?? null;
  const next = rows[at + 1] ?? null;
  return previous || next ? { previous, next } : null;
}

/** One side of the pager. A neighbour this reader may open is a door, so its title is one; the
 * rest are names with a lock beside them, which is what the outline does with the same rows. */
function PagerCell({
  row,
  courseId,
  back,
}: {
  row: CatalogLesson | null;
  courseId: string;
  back: boolean;
}) {
  const caption = back ? 'Previous' : 'Next';
  const align = back ? '' : 'sm:items-end sm:text-right';

  if (!row) {
    return (
      <p
        className={cn(
          'flex flex-col justify-center rounded-card border border-dashed border-line px-4 py-3',
          'text-[0.8125rem] text-ink-faint',
          align,
        )}
      >
        {back ? 'Start of the course' : 'End of the course'}
      </p>
    );
  }

  const frame = cn('flex flex-col gap-1 rounded-card px-4 py-3', align);

  if (!row.isReadable) {
    return (
      <p data-icon-zone className={`${frame} border border-line`}>
        <span className="flex items-center gap-1.5 text-[0.8125rem] text-ink-faint">
          <Icon name="lock" size="sm" label="Behind enrollment" />
          {caption}
        </span>
        <span className="text-[0.9375rem] text-ink-muted">{row.title}</span>
      </p>
    );
  }

  return (
    <Link
      href={`/courses/${courseId}/lessons/${row.id}`}
      data-icon-zone
      className={cn(
        frame,
        'border border-line bg-surface',
        'transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
        'hover:border-brand-line hover:bg-brand-soft',
      )}
    >
      <span className="flex items-center gap-1.5 text-[0.8125rem] text-ink-faint">
        {back ? <Icon name="chevron-left" size="sm" /> : null}
        {caption}
        {back ? null : <Icon name="chevron-right" size="sm" />}
      </span>
      <span className="text-[0.9375rem] font-medium text-brand">{row.title}</span>
    </Link>
  );
}

export function CourseLesson({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { status } = useSession();
  const [settled, setSettled] = useState<{ key: string; state: PageState } | null>(null);
  const [syllabus, setSyllabus] = useState<{ key: string; rows: CatalogLesson[] } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Two readers, two answers: the catalog opens a page by the session cookie, which the browser
  // sends whether or not this portal has worked out who is here yet. A key that left the reader
  // out would keep a stranger's refusal up under the student who signed in after it.
  const reader = status === 'signed-in' ? 'member' : 'visitor';
  const key = `${courseId}:${lessonId}:${attempt}:${reader}`;
  // The syllabus is keyed by course and reader and not by page, because the outline a reader
  // walks does not change as they move along it — walking the pager costs one read, not one per
  // page. Which doors are open in it does depend on who is asking, so the reader is in the key.
  const syllabusKey = `${courseId}:${reader}`;

  useEffect(() => {
    // Asking before the boot read lands is a question put to nobody.
    if (status === 'bootstrapping') return;

    let alive = true;

    readLessonPage(courseId, lessonId)
      .then((found) => {
        if (alive) setSettled({ key, state: { status: 'ready', lesson: found } });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (isNotFound(error)) setSettled({ key, state: { status: 'not-found' } });
        else setSettled({ key, state: { status: 'failed', message: describeFailure(error) } });
      });

    return () => {
      alive = false;
    };
  }, [key, courseId, lessonId, status]);

  const state: PageState = settled && settled.key === key ? settled.state : { status: 'loading' };

  useEffect(() => {
    if (status === 'bootstrapping') return;
    // The outline is worth its request only once there is a page to place. A refusal needs no
    // neighbours, and asking about the syllabus around a page this reader cannot open would be
    // a second question about the same closed door.
    if (state.status !== 'ready') return;
    // Once per course and reader: the walk does not change as the reader moves along it, and
    // the page read going out and coming back is not a new question about the syllabus.
    if (syllabus && syllabus.key === syllabusKey) return;

    let alive = true;

    readCatalogCourse(courseId)
      .then((course) => {
        if (alive) setSyllabus({ key: syllabusKey, rows: walkingOrder(course) });
      })
      .catch(() => {
        // The page this screen exists to show is already on screen. A pager that did not arrive
        // is a missing convenience, so it says nothing rather than breaking the read.
      });

    return () => {
      alive = false;
    };
  }, [courseId, state.status, status, syllabus, syllabusKey]);

  const rows = syllabus && syllabus.key === syllabusKey ? syllabus.rows : null;

  if (state.status === 'loading') {
    return (
      <SkeletonGroup
        rows={6}
        rowClassName="h-5 w-full"
        label="Loading this page"
        className="flex flex-col gap-4"
      />
    );
  }

  if (state.status === 'not-found') {
    return (
      <div>
        <Link
          href={`/courses/${courseId}`}
          className="text-[0.8125rem] text-brand underline-offset-4 hover:underline"
        >
          Back to the course
        </Link>
        <EmptyState
          className="mt-4"
          illustration={<Illo src="/illustrations/peep-standing-01.svg" size="lg" />}
          title="This page is not here"
          description="A page opens two ways: a teacher left this one free to read, or you hold a place in the course. Neither, or the link has a mistake in it."
        />
      </div>
    );
  }

  if (state.status === 'failed') {
    return (
      <ErrorState
        title="This page did not load"
        message={state.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const lesson = state.lesson;
  const pager = rows ? neighbours(rows, lesson.id) : null;

  return (
    <article>
      <Link
        href={`/courses/${lesson.course.id}`}
        className="text-[0.8125rem] text-brand underline-offset-4 hover:underline"
      >
        {lesson.course.title}
      </Link>

      <header className="mt-3">
        {/* How this reader got in is the teacher's statement about the page, not the reader's
            own situation: a student holding a place is not reading a preview. */}
        {lesson.isFreePreview ? <p className="eyebrow">Free to read</p> : null}
        <h1 className="mt-2 text-h1 text-ink-strong">{lesson.title}</h1>
        <p className="tabular mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-faint">
          <span>
            Module {lesson.module.position}: {lesson.module.title}
          </span>
          <span aria-hidden="true">·</span>
          {lesson.estimatedMinutes === null ? (
            <span>Not timed</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size="sm" />
              {lesson.estimatedMinutes} min
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span>updated {UPDATED.format(new Date(lesson.updatedAt))}</span>
        </p>
      </header>

      {lesson.video ? (
        <LessonPlayer courseId={lesson.course.id} lessonId={lesson.id} video={lesson.video} />
      ) : null}

      {lesson.body === null ? (
        <p className="mt-8 max-w-[68ch] text-[0.9375rem] text-ink-muted">
          This page is open to read, but it has nothing written on it yet.
        </p>
      ) : (
        <p
          data-lesson-body
          className="mt-8 max-w-[68ch] whitespace-pre-wrap text-[1.0625rem] leading-[1.75] text-ink"
        >
          {lesson.body}
        </p>
      )}

      {pager ? (
        <nav aria-label="More of this course" className="mt-10 grid gap-3 sm:grid-cols-2">
          <PagerCell row={pager.previous} courseId={lesson.course.id} back />
          <PagerCell row={pager.next} courseId={lesson.course.id} back={false} />
        </nav>
      ) : null}

      <div className="mt-10 border-t border-line pt-6">
        <p className="max-w-[60ch] text-[0.9375rem] text-ink-muted">
          {lesson.isFreePreview
            ? 'The rest of this course is on its outline, and reading it is what enrolling is for.'
            : 'You hold a place in this course, so the rest of it is open to you on the outline.'}
        </p>
        <Link
          href={`/courses/${lesson.course.id}`}
          className={`${buttonClass({ variant: 'secondary' })} mt-4`}
        >
          {lesson.isFreePreview ? 'See the rest of this course' : 'Back to the syllabus'}
        </Link>
      </div>
    </article>
  );
}
