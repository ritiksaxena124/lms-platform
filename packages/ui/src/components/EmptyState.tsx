'use client';

import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** A line-art icon from `lucide-react` or similar; sized by this component. */
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Keeps the action button honest while its request is in flight. */
  actionBusy?: boolean;
  className?: string;
}

/**
 * The zero case for a list, search or filter. Announced politely, because an
 * empty result *is* an answer — it just arrives after a request.
 */
export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  actionBusy = false,
  className,
}: EmptyStateProps) {
  const showAction = Boolean(actionLabel && onAction);

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-paper px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="mb-3 text-ink-faint [&>svg]:size-6">
          {icon}
        </span>
      ) : null}
      <h3 className="font-display text-h3 text-ink-strong">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-[46ch] text-[0.9375rem] text-ink-muted">{description}</p>
      ) : null}
      {showAction ? (
        <Button
          variant="primary"
          size="sm"
          className="mt-5"
          loading={actionBusy}
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
