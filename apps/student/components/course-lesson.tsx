'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState, Icon, Illo, SkeletonGroup, buttonClass } from '@lms/ui';
import type { CatalogLessonPage } from '@lms/shared';

import { describeFailure, isNotFound } from '@/lib/api';
import { readLessonPage } from '@/lib/catalog';

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

export function CourseLesson({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const [settled, setSettled] = useState<{ key: string; state: PageState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${courseId}:${lessonId}:${attempt}`;

  useEffect(() => {
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
  }, [key, courseId, lessonId]);

  const state: PageState = settled && settled.key === key ? settled.state : { status: 'loading' };

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
