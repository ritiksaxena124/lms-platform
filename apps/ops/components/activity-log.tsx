'use client';

import { useEffect, useState } from 'react';
import {
  ACTION_SECTION_CODES,
  actionActorKindLabel,
  actionLabel,
  actionSectionLabel,
  type ActionListResponse,
  type ActionLogEntry,
  type ActionSectionCode,
} from '@lms/shared';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Illo,
  SkeletonGroup,
  Select,
  type SelectOption,
} from '@lms/ui';

import { describeFailure } from '@/lib/api';
import { listActions } from '@/lib/actions';
import { formatInstant } from '@/lib/dates';

import { useSession } from './session-provider';

const SECTION_OPTIONS: SelectOption[] = [
  { value: '', label: 'Everything' },
  ...Object.values(ACTION_SECTION_CODES).map((code: ActionSectionCode) => ({
    value: code,
    label: actionSectionLabel(code),
  })),
];

/** The decided facts a row carries, as the words the writer chose for them.
 *
 * `detail` is a flat object of strings, numbers and booleans and nothing else (7a's rule), which is
 * what lets a screen print it without a per-action renderer. A future action with a fact nobody can
 * label usefully is that action's problem to solve here, not a reason to blank out every row.
 */
function detailOf(entry: ActionLogEntry): string[] {
  return Object.entries(entry.detail ?? {}).map(
    ([key, value]) =>
      `${key}: ${typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)}`,
  );
}

type Settled = { key: string; page: ActionListResponse };

/**
 * The ledger, newest first, one question at a time.
 *
 * This is Phase 7's table meeting its first reader: thirty-three codes, seven parts of the platform,
 * and no row that can be edited from here. The API answers six filters; this screen offers the one a
 * person actually starts with — which part of the app — because the other five are questions about a
 * specific account or a specific row, and an operator who has one of those has come from the screen
 * that names it.
 *
 * An actor is printed as a name and nothing else, exactly as the route sends it. The address is not
 * in the payload to begin with: a log row outlives the correction a person makes to their account,
 * and an address copied into a table kept forever is an address kept forever (§18).
 *
 * "Loading" is derived rather than stored: the request carries the question it answers, and an answer
 * whose question has changed is not an answer. A `status` field would need resetting on every filter
 * change, which is a second render for something the render can already see.
 */
export function ActivityLog() {
  const { user } = useSession();
  const [section, setSection] = useState<ActionSectionCode | ''>('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const key = `${section}:${page}:${attempt}`;

  useEffect(() => {
    let alive = true;
    const filters: { section?: ActionSectionCode; page: number } = { page };
    if (section) filters.section = section;

    listActions(filters)
      .then((result) => {
        if (alive) setSettled({ key, page: result });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key, section, page]);

  if (settled?.key !== key && failure?.key === key) {
    return (
      <ErrorState
        title="The ledger did not load"
        message={failure.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        id="section"
        label="Part of the platform"
        options={SECTION_OPTIONS}
        value={section}
        onChange={(event) => {
          setSection(event.target.value as ActionSectionCode | '');
          setPage(1);
        }}
        containerClassName="w-full sm:w-64"
      />
    </div>
  );

  if (settled?.key !== key) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <SkeletonGroup
          rows={4}
          rowClassName="h-20 w-full rounded-card"
          label="Loading the ledger"
          className="flex flex-col gap-3"
        />
      </div>
    );
  }

  const { page: result } = settled;
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const paged = result.total > result.pageSize;

  return (
    <div className="flex flex-col gap-4">
      {filters}

      <p className="text-label text-ink">
        {`${result.total} logged actions`}
        {result.items.length > 0 ? <span className="text-ink-faint"> · newest first</span> : null}
      </p>

      {result.items.length === 0 ? (
        <EmptyState
          illustration={<Illo src="/illustrations/peep-sitting-06.svg" size="lg" />}
          title="Nothing recorded for that question"
          description="The ledger only holds writes that changed a standing row, so a section with no activity is a section nobody has touched — not a page that failed to read."
          actionLabel="Show everything"
          onAction={() => {
            setSection('');
            setPage(1);
          }}
        />
      ) : (
        <ul aria-label="Activity log" className="flex flex-col gap-3">
          {result.items.map((entry) => (
            <li
              key={entry.id}
              data-icon-zone
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <div className="min-w-0">
                <h3 className="text-h3 text-ink-strong">{actionLabel(entry.actionCode)}</h3>
                <p className="mt-1 text-[0.8125rem] text-ink-muted">
                  {entry.actor ? entry.actor.fullName : actionActorKindLabel(entry.actorKind)}
                  <span className="text-ink-faint"> · {actionSectionLabel(entry.sectionCode)}</span>
                </p>
                {detailOf(entry).length > 0 ? (
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[0.8125rem] text-ink-faint">
                    {detailOf(entry).map((fact) => (
                      <span key={fact} className="rounded-field bg-paper px-2 py-0.5">
                        {fact}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
              <p className="tabular shrink-0 text-[0.8125rem] text-ink-faint">
                <Icon name="clock" size="sm" />
                <span className="ml-1.5">{formatInstant(entry.createdAt, user?.timezone)}</span>
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
          <span className="tabular text-[0.8125rem] text-ink-muted">{`Page ${result.page} of ${lastPage}`}</span>
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
