'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ROLE_CODES,
  type AccountStatusCode,
  type OpsAccount,
  type OpsAccountListResponse,
  type RoleCode,
} from '@lms/shared';
import {
  Button,
  EmptyState,
  ErrorState,
  Illo,
  SkeletonGroup,
  Select,
  StatusPill,
  TextField,
  notify,
  type StatusTone,
} from '@lms/ui';

import { describeFailure } from '@/lib/api';
import { listAccounts, setAccountRole, setAccountStatus } from '@/lib/accounts';
import { formatInstant } from '@/lib/dates';

import { useSession } from './session-provider';

const ROLE_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: ROLE_CODES.STUDENT, label: 'Students' },
  { value: ROLE_CODES.TEACHER, label: 'Teachers' },
  { value: ROLE_CODES.OPS, label: 'Operators' },
];

/** The two roles a revoked operator can land on, and the reason the body of that PATCH is a role
 * rather than a `revoke` flag: an account with no role could not open either portal, and a screen
 * that picked one for them would be guessing at a person's history from a button. */
const REVOCABLE_TO = [
  { value: '', label: 'Choose' },
  { value: ROLE_CODES.STUDENT, label: 'Student' },
  { value: ROLE_CODES.TEACHER, label: 'Teacher' },
];

function statusTone(code: AccountStatusCode): StatusTone {
  return code === 'active' ? 'success' : 'warning';
}

type Settled = { key: string; page: OpsAccountListResponse };

/**
 * The accounts, and the two things an operator may do to one.
 *
 * There is no edit form here on purpose. A name, an address and a timezone belong to the person who
 * has the account; what is left — whether the account may sign in, and which of the three portals it
 * opens — is the only part an operator is allowed to decide, and both of those are a single deliberate
 * click rather than a form that could be saved half-changed.
 *
 * The row an operator is standing in is shown and not touched: the route refuses to move your own
 * account, and a screen that let you click it would turn a correct refusal into a mystery.
 *
 * A write leaves the row reading as the API answered, not as the button asked, and the row is only
 * replaced once the PATCH has come back.
 */
export function AccountTable() {
  const { user } = useSession();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const [role, setRole] = useState<RoleCode | ''>('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revokeTo, setRevokeTo] = useState<Record<string, RoleCode | ''>>({});

  const q = search?.trim() ? search.trim() : undefined;
  const key = `${q ?? ''}:${role}:${page}:${attempt}`;

  useEffect(() => {
    let alive = true;
    const filters: { q?: string; role?: RoleCode; page: number } = { page };
    if (q) filters.q = q;
    if (role) filters.role = role;

    listAccounts(filters)
      .then((result) => {
        if (alive) setSettled({ key, page: result });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key, q, role, page]);

  /** The answer replaces its own row, and nothing else about the page that was read. */
  function settle(updated: OpsAccount) {
    setSettled((current) =>
      current
        ? {
            ...current,
            page: {
              ...current.page,
              items: current.page.items.map((row) => (row.id === updated.id ? updated : row)),
            },
          }
        : current,
    );
  }

  /** One click, one PATCH, one row. A refusal leaves the row exactly as the list read it, because a
   * screen that greyed out an action the API refused would be reporting a change it did not make. */
  async function write(
    id: string,
    run: () => Promise<OpsAccount>,
    celebrate: (who: string) => string,
  ) {
    setBusy(id);
    try {
      const updated = await run();
      settle(updated);
      notify.success(celebrate(updated.fullName));
    } catch (error) {
      notify.error(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(typed);
    setPage(1);
  }

  if (settled?.key !== key && failure?.key === key) {
    return (
      <ErrorState
        title="The accounts did not load"
        message={failure.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <form
        onSubmit={submit}
        className="flex min-w-0 flex-1 flex-wrap items-end gap-3"
        role="search"
      >
        <TextField
          id="q"
          label="Name or email"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="aditi@example.test"
          className="min-w-0 flex-1"
          containerClassName="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>
      <Select
        id="role"
        label="Role"
        options={ROLE_OPTIONS}
        value={role}
        onChange={(event) => {
          setRole(event.target.value as RoleCode | '');
          setPage(1);
        }}
        containerClassName="w-full sm:w-44"
      />
    </div>
  );

  if (settled?.key !== key) {
    return (
      <div className="flex flex-col gap-4">
        {controls}
        <SkeletonGroup
          rows={4}
          rowClassName="h-20 w-full rounded-card"
          label="Loading accounts"
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
      {controls}

      <p className="text-label text-ink">
        {`${result.total} ${result.total === 1 ? 'account' : 'accounts'}`}
        {result.items.length > 0 ? <span className="text-ink-faint"> · newest first</span> : null}
      </p>

      {result.items.length === 0 ? (
        <EmptyState
          illustration={<Illo src="/illustrations/peep-sitting-06.svg" size="lg" />}
          title="No account matches that search"
          description="A name and an address are both searched as written, so try the first letters of one or the whole of the other."
          actionLabel="Show everyone"
          onAction={() => {
            setTyped('');
            setSearch(null);
            setRole('');
            setPage(1);
          }}
        />
      ) : (
        <ul aria-label="Accounts" className="flex flex-col gap-3">
          {result.items.map((entry) => {
            const isSelf = user?.id === entry.id;
            const isOps = entry.roleCode === ROLE_CODES.OPS;

            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 rounded-card border border-line bg-surface p-4 sm:p-5"
              >
                <div className="min-w-0">
                  <h3 className="text-h3 text-ink-strong">
                    {entry.fullName}
                    {isSelf ? (
                      <span className="ml-2 text-[0.8125rem] text-ink-faint">
                        {' '}
                        This is your account
                      </span>
                    ) : null}
                  </h3>
                  <p className="mt-0.5 truncate text-[0.8125rem] text-ink-muted">{entry.email}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusPill tone={isOps ? 'ember' : 'neutral'}>{entry.roleLabel}</StatusPill>
                    <StatusPill tone={statusTone(entry.statusCode)}>{entry.statusLabel}</StatusPill>
                    <span className="tabular text-[0.8125rem] text-ink-faint">
                      {entry.lastLoginAt
                        ? `Last in ${formatInstant(entry.lastLoginAt, user?.timezone)}`
                        : 'Never signed in'}
                    </span>
                  </p>
                </div>

                {isSelf ? null : (
                  <div className="flex shrink-0 flex-wrap items-end gap-2">
                    {isOps ? (
                      <>
                        <Select
                          id={`revoke-to-${entry.id}`}
                          label="Revoke to"
                          options={REVOCABLE_TO}
                          value={revokeTo[entry.id] ?? ''}
                          onChange={(event) =>
                            setRevokeTo((current) => ({
                              ...current,
                              [entry.id]: event.target.value as RoleCode | '',
                            }))
                          }
                          containerClassName="w-32"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy === entry.id || !revokeTo[entry.id]}
                          loading={busy === entry.id}
                          onClick={() =>
                            void write(
                              entry.id,
                              () => setAccountRole(entry.id, revokeTo[entry.id] as RoleCode),
                              (who) => `${who} is no longer an operator.`,
                            )
                          }
                        >
                          Revoke
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy === entry.id}
                        loading={busy === entry.id}
                        onClick={() =>
                          void write(
                            entry.id,
                            () => setAccountRole(entry.id, ROLE_CODES.OPS),
                            (who) => `${who} can open this desk.`,
                          )
                        }
                      >
                        Make ops
                      </Button>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant={entry.statusCode === 'active' ? 'danger' : 'primary'}
                      disabled={busy === entry.id}
                      loading={busy === entry.id}
                      onClick={() =>
                        void write(
                          entry.id,
                          () =>
                            setAccountStatus(
                              entry.id,
                              entry.statusCode === 'active' ? 'disabled' : 'active',
                            ),
                          (who) =>
                            entry.statusCode === 'active'
                              ? `${who} is disabled.`
                              : `${who} can sign in again.`,
                        )
                      }
                    >
                      {entry.statusCode === 'active' ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
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
