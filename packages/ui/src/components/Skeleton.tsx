import { cn } from '../lib/cn';

export interface SkeletonProps {
  className?: string;
}

/**
 * One shimmering block. Always `aria-hidden`: the shimmer is a layout promise for
 * sighted users, and screen readers should hear from the group around it instead.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      data-testid="skeleton"
      aria-hidden="true"
      className={cn('lms-skeleton block', className)}
    />
  );
}

export interface SkeletonGroupProps {
  rows?: number;
  /** Height of each row; match the real content so nothing jumps when it lands. */
  rowClassName?: string;
  label?: string;
  className?: string;
}

/**
 * A loading list: a single polite live region wrapping decorative rows, so the
 * announcement happens once rather than per shimmer.
 */
export function SkeletonGroup({
  rows = 3,
  rowClassName = 'h-5 w-full',
  label = 'Loading',
  className,
}: SkeletonGroupProps) {
  return (
    <span role="status" aria-label={label} className={cn('block space-y-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={rowClassName} />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}
