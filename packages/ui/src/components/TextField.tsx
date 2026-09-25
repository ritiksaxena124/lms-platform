'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * Everything a field is made of, in the order a screen reader meets them: the label, the
 * control, the hint that stops a mistake before it happens, and the error that explains one
 * after.
 *
 * `id` is required rather than generated, because the two things that must agree on it —
 * `htmlFor` and the browser's own autofill — are exactly the ones a generated id gets wrong
 * on the server render. A field without an `id` is a field nobody can fill in.
 */
export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  /** Optional, low-stakes guidance: what the value is for, not how to spell it. */
  hint?: ReactNode;
  /** One message or the list the API sent for this field; absent means the field is fine. */
  error?: string | readonly string[];
  /** A control inside the field's own box — a reveal toggle, a unit, a clear button. */
  trailing?: ReactNode;
  containerClassName?: string;
}

const FIELD_CLASS = [
  'h-9.5 w-full rounded-field border border-line-strong bg-surface px-3',
  'text-[0.9375rem] text-ink placeholder:text-ink-faint',
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
  'hover:border-ink-faint',
  'disabled:pointer-events-none disabled:bg-paper-sunk disabled:opacity-60',
  'aria-[invalid=true]:border-danger',
].join(' ');

export function TextField({
  id,
  label,
  hint,
  error,
  trailing,
  containerClassName,
  className,
  type = 'text',
  ...rest
}: TextFieldProps) {
  const messages = error === undefined ? [] : Array.isArray(error) ? error : [error];
  const describedBy = [hint ? `${id}-hint` : null, messages.length > 0 ? `${id}-error` : null]
    .filter((part): part is string => part !== null)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={id} className="text-label text-ink-muted">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={id}
          type={type}
          aria-invalid={messages.length > 0 ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(FIELD_CLASS, trailing ? 'pr-10' : undefined, className)}
          {...rest}
        />
        {trailing ? (
          <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>
        ) : null}
      </div>

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
