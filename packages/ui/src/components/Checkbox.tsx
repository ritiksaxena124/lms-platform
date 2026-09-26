'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * One yes or no, said twice: in a box and in words beside it.
 *
 * The control is a native checkbox with `accent-color` pointed at the brand token, not a
 * drawn square with a fake tick. A box that only looks like a checkbox is a box that behaves
 * like one to nobody — keyboard, screen reader, the platform's own spacing of a tick — and
 * the only thing the real one lacked was the colour.
 *
 * `id` is required for the same reason every other field requires one: the label, the hint and
 * the error all have to agree on it, and a generated id gets the server render wrong.
 */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  id: string;
  label: string;
  /** What the yes commits to, when it is not obvious from the label alone. */
  hint?: ReactNode;
  /** One message or the list the API sent for this field; absent means the box is fine. */
  error?: string | readonly string[];
  containerClassName?: string;
}

const BOX_CLASS = [
  'mt-0.5 size-4.5 shrink-0 accent-[var(--color-brand)]',
  'cursor-pointer',
  'disabled:cursor-not-allowed disabled:opacity-60',
].join(' ');

export function Checkbox({
  id,
  label,
  hint,
  error,
  containerClassName,
  className,
  ...rest
}: CheckboxProps) {
  const messages = error === undefined ? [] : Array.isArray(error) ? error : [error];
  const describedBy = [hint ? `${id}-hint` : null, messages.length > 0 ? `${id}-error` : null]
    .filter((part): part is string => part !== null)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          name={id}
          type="checkbox"
          aria-describedby={describedBy || undefined}
          aria-invalid={messages.length > 0 ? true : undefined}
          className={cn(BOX_CLASS, className)}
          {...rest}
        />
        <label htmlFor={id} className="text-[0.9375rem] leading-snug text-ink">
          {label}
        </label>
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
