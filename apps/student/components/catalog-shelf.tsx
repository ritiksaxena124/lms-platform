'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  EmptyState,
  ErrorState,
  Illo,
  SkeletonGroup,
  Stagger,
  cn,
} from '@lms/ui';
import type { CatalogCourseListResponse, CourseChoice } from '@lms/shared';

import { describeFailure } from '@/lib/api';
import { browseCatalog, catalogLevels, type CatalogSearch } from '@/lib/catalog';

/**
 * The shelf: every course a stranger is allowed to see, and the two ways to narrow it.
 *
 * Search and level are not two independent widgets — they are one query, and one query is one
 * request. So the filters live in this component's state, the results come from the API, and
 * nothing here re-sorts or re-counts what arrived: the order is the API's rule (newest first,
 * with an index behind it) and the counts are the gated ones its own detail page lists.
 */

/** Long enough to type a word, short enough that it does not feel stuck. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * An answer, tagged with the request that earned it.
 *
 * Keeping the two together is what makes a stale reply harmless: the shelf holds on to what it
 * already shows, and a late answer is simply not the one whose key matches. It also means
 * "loading" is derived rather than announced — a request still in flight cannot be mistaken
 * for one that came back empty, which is the difference between a skeleton and a false "no
 * courses yet".
 */
type Settled = { key: string; value: CatalogCourseListResponse | { message: string } };

const UPDATED = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function isFailure(value: Settled['value']): value is { message: string } {
  return 'message' in value;
}

/** The one place a filter becomes a request. A level or a search clears the page it was
 * applied to, so there is no "page 3 of a filter that no longer exists" to guard against. */
function queryFor(level: string | null, asked: string, page: number): CatalogSearch {
  const query: CatalogSearch = {};
  if (level) query.level = level;
  if (asked) query.q = asked;
  if (page > 1) query.page = page;
  return query;
}

function keyFor(level: string | null, asked: string, page: number, attempt: number): string {
  return `${level ?? ''}|${asked}|${page}|${attempt}`;
}

export function CatalogShelf() {
  const [levels, setLevels] = useState<CourseChoice[]>([]);
  const [level, setLevel] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [asked, setAsked] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  // Typing changes the box; only the pause after it changes what is asked for. One request per
  // keystroke would put a round trip between a person and the letter they just typed.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let alive = true;
    catalogLevels()
      .then((items) => {
        if (alive) setLevels(items);
      })
      .catch(() => {
        // Levels are a refinement, not the content. A shelf that cannot say how it filters
        // still shows its courses; the filter row simply stays out of the way.
        if (alive) setLevels([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const key = keyFor(level, asked, page, attempt);

  useEffect(() => {
    let alive = true;

    browseCatalog(queryFor(level, asked, page))
      .then((result) => {
        if (alive) setSettled({ key, value: result });
      })
      .catch((error: unknown) => {
        if (alive) setSettled({ key, value: { message: describeFailure(error) } });
      });

    return () => {
      alive = false;
    };
  }, [key, level, asked, page]);

  const value = settled && settled.key === key ? settled.value : null;
  const failure = value && isFailure(value) ? value : null;
  const result = value && !isFailure(value) ? value : null;
  const courses = result?.items ?? [];
  const lastPage = Math.max(1, Math.ceil((result?.total ?? 0) / (result?.pageSize ?? 12)));

  // A chosen level is a chip you can press again. Stacking levels is not a thing a shelf can
  // ask for — one course has one level — so the second press means "that was enough".
  function chooseLevel(code: string | null) {
    setLevel((current) => (current === code ? null : code));
    setPage(1);
  }

  function typeSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="catalog-search" className="eyebrow block text-ink-muted">
            Search courses
          </label>
          <input
            id="catalog-search"
            type="search"
            value={search}
            onChange={(event) => typeSearch(event.target.value)}
            placeholder="A title, or a word in one"
            className={cn(
              'mt-2 w-full rounded-field border border-line bg-surface px-3 py-2 text-[0.9375rem] text-ink',
              'placeholder:text-ink-faint focus:border-brand-line',
            )}
          />
        </div>

        <p aria-live="polite" className="text-[0.8125rem] text-ink-muted">
          {result
            ? `${String(result.total)} ${result.total === 1 ? 'course' : 'courses'} published`
            : '\u00a0'}
        </p>
      </div>

      {levels.length > 0 ? (
        <div role="group" aria-label="Filter by level" className="flex flex-wrap gap-1">
          {[
            { code: null as string | null, label: 'All levels' },
            ...levels.map((item) => ({ code: item.code as string | null, label: item.label })),
          ].map((chip) => (
            <button
              key={chip.code ?? 'all'}
              type="button"
              aria-pressed={level === chip.code}
              onClick={() => chooseLevel(chip.code)}
              className={cn(
                'rounded-field border px-3 py-1.5 text-label',
                'transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                level === chip.code
                  ? 'border-brand-line bg-brand-soft font-semibold text-brand-deep'
                  : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      {!result && !failure ? (
        <SkeletonGroup
          rows={6}
          rowClassName="h-40 w-full rounded-card"
          label="Loading courses"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        />
      ) : null}

      {failure ? (
        <ErrorState
          title="The shelf did not load"
          message={failure.message}
          onRetry={() => setAttempt((current) => current + 1)}
        />
      ) : null}

      {result && courses.length === 0 ? (
        level || asked ? (
          <EmptyState
            illustration={<Illo src="/illustrations/peep-sitting-01.svg" size="lg" />}
            title="Nothing on the shelf matches that"
            description="Try fewer words, or clear the search and see every course that is published."
            actionLabel="Clear the search"
            onAction={() => {
              setLevel(null);
              setSearch('');
              setAsked('');
              setPage(1);
            }}
          />
        ) : (
          <EmptyState
            illustration={<Illo src="/illustrations/peep-sitting-01.svg" size="lg" />}
            title="Nothing on the shelf yet"
            description="No course has been published yet. When a teacher publishes one, it appears here the same moment."
          />
        )
      ) : null}

      {result && courses.length > 0 ? (
        <>
          <Stagger as="ul" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" startIndex={1}>
            {courses.map((course) => (
              <li key={course.id}>
                <Card interactive className="flex h-full flex-col">
                  <p className="eyebrow">{course.level.label}</p>
                  <h3 className="mt-2 text-h2 text-ink-strong">
                    <Link
                      href={`/courses/${course.id}`}
                      transitionTypes={['nav-forward']}
                      className="text-ink-strong underline-offset-4 hover:underline"
                    >
                      {course.title}
                    </Link>
                  </h3>
                  <p className="mt-2 flex-1 text-[0.9375rem] text-ink-muted">
                    {course.summary ?? 'No summary yet — the outline says what it covers.'}
                  </p>
                  <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-3 text-[0.8125rem]">
                    <span className="text-ink">{course.teacher.displayName}</span>
                    <span className="tabular text-ink-faint">
                      {course.moduleCount}{' '}
                      {course.moduleCount === 1 ? 'module' : 'modules'} · {course.lessonCount}{' '}
                      {course.lessonCount === 1 ? 'lesson' : 'lessons'} · updated{' '}
                      {UPDATED.format(new Date(course.updatedAt))}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </Stagger>

          {lastPage > 1 ? (
            <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
              <button
                type="button"
                disabled={result.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className={cn(
                  'rounded-field border border-line bg-surface px-3 py-1.5 text-label text-ink-muted',
                  'hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                Previous page
              </button>
              <p className="text-[0.8125rem] text-ink-muted">
                Page {result.page} of {lastPage}
              </p>
              <button
                type="button"
                disabled={result.page >= lastPage}
                onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
                className={cn(
                  'rounded-field border border-line bg-surface px-3 py-1.5 text-label text-ink-muted',
                  'hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                Next page
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
