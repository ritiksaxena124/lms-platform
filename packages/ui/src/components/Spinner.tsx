import { cn } from '../lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE: Record<SpinnerSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  /** What is being waited on. Defaults to "Loading" so a spinner is never silent. */
  label?: string;
  className?: string;
}

/**
 * Two-tone arc: a single stroke disappears at 14px and a full ring reads as a
 * solid dot. The rotation lives in `motion.css`, where reduced-motion can
 * downgrade it in one place.
 */
export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      data-size={size}
      className={cn('inline-flex shrink-0 items-center', SIZE[size], className)}
    >
      <svg className="lms-spinner size-full" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
