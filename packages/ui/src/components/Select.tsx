'use client';

import type { ReactNode, SelectHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  id: string;
  label: string;
  /** The catalogue the caller is choosing from, already in the order it should read. */
  options: readonly SelectOption[];
  /** Shown until a real choice is made, and unselectable after that. */
  placeholder?: string;
  hint?: ReactNode;
  error?: string | readonly string[];
  containerClassName?: string;
}

const CONTROL_CLASS = [
  'h-9.5 w-full appearance-none rounded-field border border-line-strong bg-surface pr-9 pl-3',
  'text-[0.9375rem] text-ink',
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
  'hover:border-ink-faint',
  'disabled:pointer-events-none disabled:bg-paper-sunk disabled:opacity-60',
  'aria-[invalid=true]:border-danger',
].join(' ');

/**
 * A native `select`, not a menu built out of divs. The list of options is the part a
 * screen reader and a phone handle better than anything written here, and a course level
 * is three rows — there is no search to justify the custom widget.
 */
export function Select({
  id,
  label,
  options,
  placeholder,
  hint,
  error,
  containerClassName,
  className,
  ...rest
}: SelectProps) {
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
        <select
          id={id}
          name={id}
          aria-invalid={messages.length > 0 ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(CONTROL_CLASS, className)}
          {...rest}
        >
          {placeholder ? (
            // Empty value and disabled: a placeholder is not an answer, and a form that
            // submitted one would store a level nobody chose.
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-faint"
        >
          <path
            d="m6 8 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
