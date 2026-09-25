'use client';

import type { VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { button } from '../lib/button';
import { cn } from '../lib/cn';
import { Spinner, type SpinnerSize } from './Spinner';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** Shows the arc and blocks clicks for as long as the caller's promise is pending. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  type = 'submit',
  disabled,
  ...rest
}: ButtonProps) {
  const spinnerSize: SpinnerSize = size === 'sm' ? 'sm' : 'md';

  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      data-variant={variant}
      data-size={size}
      className={cn(button({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading ? (
        <Spinner size={spinnerSize} label="Working" />
      ) : leadingIcon ? (
        <span aria-hidden="true" className="inline-flex items-center [&>svg]:size-4">
          {leadingIcon}
        </span>
      ) : null}
      {children}
      {trailingIcon ? (
        <span aria-hidden="true" className="inline-flex items-center [&>svg]:size-4">
          {trailingIcon}
        </span>
      ) : null}
    </button>
  );
}
