import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { SkeletonGroup } from './Skeleton';

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Short context beside the title, e.g. "12 upcoming". */
  meta?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  /** Swap the title for its own skeleton, so the header never flashes empty. */
  loading?: boolean;
  className?: string;
}

/**
 * Every portal page opens the same way: where it sits in the app, what it is,
 * and what the user can do from here — on one row that wraps at narrow widths.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  breadcrumbs,
  loading = false,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        {loading ? (
          <SkeletonGroup rows={1} rowClassName="h-8 w-56" className="flex-1" />
        ) : (
          <div className="min-w-0 flex-1">
            <h1 className="text-h1 text-ink-strong">{title}</h1>
            {description ? (
              <p className="mt-1.5 max-w-[68ch] text-[0.9375rem] text-ink-muted">{description}</p>
            ) : null}
            {meta ? <p className="mt-1 text-label text-ink-faint">{meta}</p> : null}
          </div>
        )}

        {actions ? (
          <div className="flex shrink-0 items-center gap-2 pb-1 empty:hidden">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

export function Breadcrumbs({ items, className }: { items: Breadcrumb[]; className?: string }) {
  const last = items.length - 1;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-label text-ink-faint">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index === last || !item.href ? (
              <span aria-current={index === last ? 'page' : undefined} className="text-ink-muted">
                {item.label}
              </span>
            ) : (
              <>
                <a
                  href={item.href}
                  className="underline-offset-3 transition-colors duration-[var(--duration-instant)] hover:text-ember hover:underline"
                >
                  {item.label}
                </a>
                <CrumbSeparator />
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CrumbSeparator() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 text-line-strong">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
