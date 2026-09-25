import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type StatusTone = 'neutral' | 'ember' | 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<StatusTone, string> = {
  neutral: 'border-line bg-paper-sunk text-ink-muted',
  ember: 'border-ember-line bg-ember-soft text-ember-deep',
  info: 'border-info-soft bg-info-soft text-info',
  success: 'border-success-soft bg-success-soft text-success',
  warning: 'border-warning-soft bg-warning-soft text-warning',
  danger: 'border-danger-soft bg-danger-soft text-danger',
};

export interface StatusPillProps {
  tone?: StatusTone;
  /** For states that are true *right now*: in class, processing, live. */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A state label. The dot is decorative and the text always carries the meaning,
 * so the tone never has to be decoded from colour alone.
 */
export function StatusPill({
  tone = 'neutral',
  pulse = false,
  className,
  children,
}: StatusPillProps) {
  return (
    <span
      data-tone={tone}
      data-pulse={pulse ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[0.75rem] leading-none font-medium',
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="lms-dot size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
