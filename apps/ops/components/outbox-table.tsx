'use client';

import { useEffect, useState } from 'react';
import {
  MAIL_OUTBOX_STATUS_CODES,
  mailEventLabel,
  mailOutboxStatusLabel,
  MAIL_OUTBOX_STATUS_LABELS,
  type MailOutboxStatusCode,
  type OutboxEntry,
  type OutboxListResponse,
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
  StatusPill,
  type StatusTone,
} from '@lms/ui';

import { describeFailure } from '@/lib/api';
import { formatInstant } from '@/lib/dates';
import { listOutbox } from '@/lib/outbox';

import { useSession } from './session-provider';

const STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'The whole queue' },
  ...Object.values(MAIL_OUTBOX_STATUS_CODES).map((code: MailOutboxStatusCode) => ({
    value: code,
    label: MAIL_OUTBOX_STATUS_LABELS[code],
  })),
];

/** The colour that answers "is this letter somebody's problem?".
 *
 * `dropped` is neutral rather than warning: a row that was never going to be mailed was thrown away
 * on purpose, because this box has no mail host, and an operator who is told to look at it would
 * hunt for a fault that does not exist.
 */
function statusTone(code: MailOutboxStatusCode): StatusTone {
  if (code === MAIL_OUTBOX_STATUS_CODES.SENT) return 'success';
  if (code === MAIL_OUTBOX_STATUS_CODES.FAILED) return 'danger';
  if (code === MAIL_OUTBOX_STATUS_CODES.SENDING) return 'info';
  if (code === MAIL_OUTBOX_STATUS_CODES.QUEUED) return 'warning';
  return 'neutral';
}

/** What a row knows about why it has not gone yet, in the words the queue holds.
 *
 * The transport's short code, never its message — 6e kept the message out of the column, so this is
 * the whole of what a reader here is allowed to see of a mail host's refusal.
 */
function waitingOn(entry: OutboxEntry, timeZone?: string): string[] {
  const facts: string[] = [];
  if (entry.failureReason) facts.push(entry.failureReason);
  if (entry.attempts > 0 && entry.status !== MAIL_OUTBOX_STATUS_CODES.SENT) {
    facts.push(`asked ${entry.attempts} ${entry.attempts === 1 ? 'time' : 'times'}`);
  }
  if (entry.status === MAIL_OUTBOX_STATUS_CODES.QUEUED) {
    facts.push(`due ${formatInstant(entry.nextAttemptAt, timeZone)}`);
  }
  if (entry.status === MAIL_OUTBOX_STATUS_CODES.SENT && entry.sentAt) {
    facts.push(`went ${formatInstant(entry.sentAt, timeZone)}`);
  }
  return facts;
}

type Settled = { key: string; page: OutboxListResponse };

/**
 * The notification queue, newest first.
 *
 * Phase 6's outbox meeting its reader: seven kinds of news, five states, and the reason a retry
 * stopped. The letter itself is not here because the route does not send it — `payload` holds the
 * answers a template asked for, which tells an operator nothing about whether a person heard, and
 * the recipient's address is absent for the same reason the column never existed.
 *
 * Read-only by design. A row that reached `failed` has spent the retry curve the sweep obeys, and the
 * fix for the reason printed beside it is outside this platform — a mail host, a mailbox that closed.
 * A button here would resend a letter the curve already gave up on, from a screen nobody audits.
 */
export function OutboxTable() {
  const { user } = useSession();
  const [status, setStatus] = useState<MailOutboxStatusCode | ''>('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const key = `${status}:${page}:${attempt}`;

  useEffect(() => {
    let alive = true;
    const filters: { status?: MailOutboxStatusCode; page: number } = { page };
    if (status) filters.status = status;

    listOutbox(filters)
      .then((result) => {
        if (alive) setSettled({ key, page: result });
      })
      .catch((error: unknown) => {
        if (alive) setFailure({ key, message: describeFailure(error) });
      });

    return () => {
      alive = false;
    };
  }, [key, status, page]);

  if (settled?.key !== key && failure?.key === key) {
    return (
      <ErrorState
        title="The queue did not load"
        message={failure.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        id="status"
        label="State of the letter"
        options={STATUS_OPTIONS}
        value={status}
        onChange={(event) => {
          setStatus(event.target.value as MailOutboxStatusCode | '');
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
          label="Loading the queue"
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

      <p className="text-label text-ink">{`${result.total} letters`}</p>

      {result.items.length === 0 ? (
        <EmptyState
          illustration={<Illo src="/illustrations/peep-sitting-06.svg" size="lg" />}
          title="Nothing waiting in the queue"
          description="A state with no rows in it is a good answer here: the sweep mails what is due and leaves what it has sent, so an empty page means nobody is waiting on a letter."
          actionLabel="Show the whole queue"
          onAction={() => {
            setStatus('');
            setPage(1);
          }}
        />
      ) : (
        <ul aria-label="Notification queue" className="flex flex-col gap-3">
          {result.items.map((entry) => (
            <li
              key={entry.id}
              data-icon-zone
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4 sm:p-5"
            >
              <div className="min-w-0">
                <h3 className="text-h3 text-ink-strong">{mailEventLabel(entry.eventCode)}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-muted">
                  <span>{entry.recipient.fullName}</span>
                  <StatusPill tone={statusTone(entry.status)}>
                    {mailOutboxStatusLabel(entry.status)}
                  </StatusPill>
                </p>
                {waitingOn(entry, user?.timezone).length > 0 ? (
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[0.8125rem] text-ink-faint">
                    {waitingOn(entry, user?.timezone).map((fact) => (
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
