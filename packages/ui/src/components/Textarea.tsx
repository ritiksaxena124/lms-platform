'use client';

import type { ReactNode, TextareaHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | readonly string[];
  containerClassName?: string;
}

const CONTROL_CLASS = [
  'w-full rounded-field border border-line-strong bg-surface px-3 py-2',
  'text-[0.9375rem] leading-relaxed text-ink placeholder:text-ink-faint',
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
  'hover:border-ink-faint',
  'disabled:pointer-events-none disabled:bg-paper-sunk disabled:opacity-60',
  'aria-[invalid=true]:border-danger',
  // Vertical only: a reader can drag a box sideways out of the column it belongs to.
  'resize-y',
].join(' ');

/**
 * The same label, hint and error wiring as `TextField`, because a paragraph field that
 * announces itself differently from an input would be a bug nobody remembers to file.
 */
export function Textarea({
  id,
  label,
  hint,
  error,
  containerClassName,
  className,
  rows = 5,
  ...rest
}: TextareaProps) {
  const messages = error === undefined ? [] : Array.isArray(error) ? error : [error];
  const describedBy = [hint ? `${id}-hint` : null, messages.length > 0 ? `${id}-error` : null]
    .filter((part): part is string => part !== null)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={id} className="text-label text-ink-muted">
        {label}
      </label>

      <textarea
        id={id}
        name={id}
        rows={rows}
        aria-invalid={messages.length > 0 ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(CONTROL_CLASS, className)}
        {...rest}
      />

      {hint ? (
        <p id={`${id}-hint`} className="text-[0.75rem] leading-snug text-ink-faint">
          {hint}
        </p>
      ) : null}

      {messages.length > 0 ? (
        <ul
          id={`${id}-error`}
          role="alert"
          className="flex flex-col gap-0.5 text-[0.8125rem] text-danger"
        >
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
