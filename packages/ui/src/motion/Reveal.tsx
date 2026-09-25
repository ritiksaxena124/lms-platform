import { cloneElement, type CSSProperties, type ReactElement } from 'react';

import { cn } from '../lib/cn';

/**
 * One entrance step. 36ms reads as a sequence across a dashboard of six cards,
 * and is short enough that a page is never left standing still.
 */
export const REVEAL_STEP_MS = 36;

export interface RevealProps {
  /** Any single element — the animation is applied to it, not to a wrapper. */
  children: ReactElement<{ className?: string; style?: CSSProperties }>;
  /** Position in a sequence; the delay is `index * 36ms`. */
  index?: number;
  /** For the rare case where the rhythm is not a simple sequence. */
  delayMs?: number;
}

/**
 * Fades and lifts its child once, on mount. Deliberately wrapper-free: a reveal
 * must not disturb the grid it sits inside. The keyframes and the
 * `prefers-reduced-motion` opt-out live in `styles/motion.css`.
 */
export function Reveal({ children, index = 0, delayMs }: RevealProps): ReactElement {
  const props = {
    'data-reveal': '',
    className: cn(children.props.className),
    style: {
      ...children.props.style,
      '--reveal-delay': `${delayMs ?? index * REVEAL_STEP_MS}ms`,
    } as CSSProperties,
  };

  return cloneElement(children, props as Record<string, unknown>);
}
