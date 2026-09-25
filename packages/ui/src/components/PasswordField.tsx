'use client';

import { useState } from 'react';

import { TextField, type TextFieldProps } from './TextField';

/**
 * A text field whose value is hidden until the person who typed it asks to see it.
 *
 * The toggle changes its own name rather than carrying `aria-pressed`, so the button says
 * what clicking it will do *now* — which is the only thing a keyboard user can check without
 * remembering what it said a moment ago.
 */
export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'trailing'> {
  /** Defaults to `current-password`; a sign-up form must say `new-password` or the
   * password manager will offer the old one and the two columns will never agree. */
  autoComplete?: TextFieldProps['autoComplete'];
}

export function PasswordField({ ...rest }: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <TextField
      autoComplete="current-password"
      {...rest}
      type={revealed ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          className="flex size-8 items-center justify-center rounded-field text-ink-faint transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-ink/6 hover:text-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="size-4"
          >
            {revealed ? (
              <>
                <path d="M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
                <path d="M4 4l12 12" />
              </>
            ) : (
              <>
                <path d="M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
                <circle cx="10" cy="10" r="2.4" />
              </>
            )}
          </svg>
          <span className="sr-only">{revealed ? 'Hide password' : 'Show password'}</span>
        </button>
      }
    />
  );
}
