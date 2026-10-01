'use client';

import { Info } from 'lucide-react';
import { cloneElement, useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * A sentence that appears when a control is asked about, and disappears when the asking stops.
 *
 * The bubble is always in the document and attached to its trigger with `aria-describedby`: a
 * pointer-only explanation would be no explanation for anybody reading the page with a keyboard or
 * a screen reader. What hover changes is whether the bubble is *painted*, which is why the hidden
 * state is opacity rather than `display: none` — the second would take the text out of the
 * accessibility tree the first was written for.
 */
export type TooltipSide = 'top' | 'bottom';

export interface TooltipProps {
  /** The explanation. Kept to a sentence or two: a paragraph is a paragraph, not a tooltip. */
  content: ReactNode;
  /** One focusable control or mark. The bubble hangs off it, and so does its description. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: TooltipSide;
  className?: string;
}

const SIDE: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-1.5',
  bottom: 'top-full left-1/2 mt-1.5',
};

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        role="tooltip"
        id={id}
        data-open={open ? 'true' : undefined}
        className={cn(
          'absolute z-30 w-max max-w-[19rem] -translate-x-1/2 rounded-field bg-ink-strong px-2.5 py-1.5 text-left text-[0.75rem] leading-snug font-normal text-ink-inverse transition-[opacity,translate] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
          SIDE[side],
          open
            ? 'translate-y-0 pointer-events-auto opacity-100'
            : '-translate-y-1 pointer-events-none opacity-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}

export interface InfoTipProps {
  /** What the sentence is about, as the mark's accessible name — "What Archive does", not "Info". */
  label: string;
  side?: TooltipSide;
  className?: string;
  /** The sentence. A child rather than a `content` prop: the mark reads as a footnote to it. */
  children: ReactNode;
}

/**
 * The mark that asks for the sentence. It is a button that does nothing, deliberately: a plain icon
 * would be invisible to the keyboard, and a link would promise a page.
 */
export function InfoTip({ label, children, side, className }: InfoTipProps) {
  return (
    <Tooltip content={children} side={side} className={className}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-pill text-ink-faint transition-colors duration-[var(--duration-fast)] hover:text-ink"
      >
        <Info size={14} strokeWidth={1.5} />
      </button>
    </Tooltip>
  );
}
