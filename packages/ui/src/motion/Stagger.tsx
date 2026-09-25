import {
  Children,
  isValidElement,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

import { Reveal } from './Reveal';

export interface StaggerProps {
  /** Element to render; pass `section`, `ul`, or `div` (default) to fit the semantics. */
  as?: ElementType;
  children: ReactNode;
  className?: string;
  /** Continue a sequence that started in an earlier group. */
  startIndex?: number;
}

/**
 * Reveals a group in sequence. Empty slots (`{isLoading && <Row />}`, `null`)
 * are dropped rather than stealing a beat, so the rhythm does not depend on
 * which branches happened to render.
 *
 * Children receive the reveal attributes directly, so each must be a DOM element
 * or a component that spreads unknown props onto its node — `Card` does, a
 * component that ignores them will silently never animate.
 */
export function Stagger({ as: Tag = 'div', children, className, startIndex = 0 }: StaggerProps) {
  // `toArray` drops the empty slots first, so the map index *is* the beat number
  // and nothing has to be counted while rendering.
  const items = Children.toArray(children).map((child, index) =>
    isValidElement<{ className?: string; style?: CSSProperties }>(child) ? (
      <Reveal key={index} index={startIndex + index}>
        {child}
      </Reveal>
    ) : (
      child
    ),
  );

  return <Tag className={className}>{items}</Tag>;
}
