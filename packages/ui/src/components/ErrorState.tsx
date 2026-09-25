'use client';

import { cn } from '../lib/cn';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Pass this only when a retry can plausibly succeed (a fetch, not a permission). */
  onRetry?: () => void;
  retryLabel?: string;
  /** True while the retry request is in flight. */
  busy?: boolean;
  className?: string;
}

/**
 * The failure case. `role="alert"` because nothing the user did next will work
 * until this is resolved, so it must interrupt.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  busy = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-4 rounded-card border border-danger-soft bg-danger-soft/45 p-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="font-display text-h3 text-danger">{title}</h3>
        {message ? (
          <p className="mt-1 max-w-[62ch] text-[0.9375rem] text-ink-muted">{message}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" type="button" loading={busy} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
