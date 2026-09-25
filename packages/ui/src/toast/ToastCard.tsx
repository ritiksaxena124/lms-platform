'use client';

import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type ToastTone = 'neutral' | 'success' | 'error' | 'info' | 'loading';

const TONE_ACCENT: Record<ToastTone, string> = {
  neutral: 'bg-line-strong',
  success: 'bg-success',
  error: 'bg-danger',
  info: 'bg-info',
  loading: 'bg-ember',
};

const TONE_TEXT: Record<ToastTone, string> = {
  neutral: 'text-ink-muted',
  success: 'text-success',
  error: 'text-danger',
  info: 'text-info',
  loading: 'text-ember',
};

export interface ToastCardProps {
  tone: ToastTone;
  message: string;
  /** Field-level errors or secondary context, one line each. */
  details?: string[];
  action?: { label: string; onClick: () => void };
  /** Rendered in the accent slot; the tone colour still applies. */
  icon?: ReactNode;
  onDismiss?: () => void;
}

/**
 * The toast body, shared by every notification path so an API error and a
 * client-side success look like the same object. Errors are a live region with
 * `role="alert"`; everything else announces politely, because it can wait.
 */
export function ToastCard({ tone, message, details, action, icon, onDismiss }: ToastCardProps) {
  const isError = tone === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={cn(
        'lms-pop pointer-events-auto flex w-full max-w-sm items-stretch gap-3 overflow-hidden rounded-card border border-line bg-surface pr-2 shadow-overlay',
      )}
    >
      <span aria-hidden="true" className={cn('w-1 shrink-0 rounded-l-card', TONE_ACCENT[tone])} />

      <span aria-hidden="true" className={cn('mt-3.5 inline-flex shrink-0', TONE_TEXT[tone])}>
        {icon ?? <ToneGlyph tone={tone} />}
      </span>

      <div className="min-w-0 flex-1 py-3">
        <p className="break-words text-[0.9375rem] leading-snug font-medium text-ink">{message}</p>
        {details?.length ? (
          <ul className="mt-1 space-y-0.5">
            {details.map((line) => (
              <li key={line} className="break-words text-[0.8125rem] text-ink-muted">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className={cn(
              'mt-2 rounded-field border border-line px-2.5 py-1 text-[0.8125rem] font-medium',
              'transition-colors duration-[var(--duration-fast)] hover:border-ember-line hover:bg-ember-soft',
              'text-ember-deep',
            )}
          >
            {action.label}
          </button>
        ) : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="my-2 self-start rounded-field p-1 text-ink-faint transition-colors duration-[var(--duration-fast)] hover:bg-paper-sunk hover:text-ink"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function ToneGlyph({ tone }: { tone: ToastTone }) {
  const shared = { className: 'size-4', viewBox: '0 0 20 20', 'aria-hidden': true } as const;

  if (tone === 'success') {
    return (
      <svg {...shared} fill="none">
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="m6.4 10.3 2.3 2.3 4.6-5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  if (tone === 'error') {
    return (
      <svg {...shared} fill="none">
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="10" cy="14" r="0.9" fill="currentColor" />
      </svg>
    );
  }

  if (tone === 'loading') {
    return (
      <svg {...shared} className="lms-spinner size-4" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
        <path d="M17.5 10A7.5 7.5 0 0 0 10 2.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }

  return (
    <svg {...shared} fill="none">
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9.25v4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="6.4" r="0.9" fill="currentColor" />
    </svg>
  );
}
