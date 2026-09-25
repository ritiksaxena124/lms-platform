import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'> {
  /** Visual weight: `flat` is a hairline ring, `raised` a firmer border. Neither floats. */
  elevation?: 'flat' | 'raised';
  /** `flush` drops the default padding so a table or media block can own its edges. */
  padding?: 'default' | 'flush' | 'tight';
  interactive?: boolean;
  children: ReactNode;
}

/**
 * The content unit of every portal. Separation is drawn with a border rather
 * than shadowed, so a dashboard of twelve cards reads as one grid on one plane.
 *
 * Extra attributes are spread onto the node, which is what lets `<Stagger>` hand
 * each card its own reveal delay.
 */
export function Card({
  elevation = 'flat',
  padding = 'default',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface',
        elevation === 'flat' ? 'shadow-hairline' : 'border-line-strong',
        padding === 'default' && 'p-5',
        padding === 'tight' && 'p-3.5',
        interactive &&
          'transition-[border-color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:-translate-y-px hover:border-line-strong hover:bg-paper/60',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  /** Small uppercase label above the title, e.g. "This week". */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ eyebrow, title, description, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="text-h2 text-ink-strong">{title}</h2>
        {description ? <p className="mt-1 text-[0.9375rem] text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
