'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Spinner, type SpinnerSize } from './Spinner';

const button = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-field border',
    'font-medium leading-none select-none',
    'transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
    'active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-55',
  ],
  {
    variants: {
      variant: {
        // The one gradient in the button set: it marks the single action a view
        // most wants you to take, and nothing else reaches for it.
        primary: 'border-brand-deep bg-brand-gradient text-white hover:border-brand',
        secondary: 'border-line-strong bg-surface text-ink hover:border-ink-faint hover:bg-paper',
        ghost: 'border-transparent bg-transparent text-ink-muted hover:bg-ink/6 hover:text-ink',
        danger: 'border-danger bg-danger text-white hover:bg-[#a82944]',
      },
      size: {
        sm: 'h-8 px-3 text-[0.8125rem]',
        md: 'h-9.5 px-3.5 text-[0.875rem]',
        lg: 'h-11 px-5 text-[0.9375rem]',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', fullWidth: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof button>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof button>['size']>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  /** Shows the arc and blocks clicks for as long as the caller's promise is pending. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/**
 * The button styling on its own, so a Next `<Link>` can look identical to an
 * action that posts to the API.
 */
export function buttonClass(props: VariantProps<typeof button> = {}): string {
  return cn(button(props));
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
