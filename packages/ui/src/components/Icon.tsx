import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * The icon set: one stroke geometry, one gesture vocabulary.
 *
 * Every glyph is drawn on a 20×20 box in `currentColor` at the same weight as a
 * hairline border, so an icon sits in a line of text without shouting over it
 * and re-colours with the row around it. Nothing here is a raster or an
 * imported family: a portal adds a glyph by naming it, not by hunting for a
 * file.
 *
 * The hover gestures live in `styles/motion.css`, keyed off the icon's name,
 * because an icon that moves on its own promises a target that is not there —
 * they answer to the card or row under the pointer, and that host knows
 * better than the glyph does.
 */
export type IconName =
  | 'search'
  | 'clock'
  | 'lock'
  | 'unlock'
  | 'layers'
  | 'arrow-right'
  | 'user';

/** Ordered, not a `keyof`: the story gallery and the test that guards it walk
 * this list, so a name added to the union without artwork fails loudly. */
export const ICON_NAMES = [
  'search',
  'clock',
  'lock',
  'unlock',
  'layers',
  'arrow-right',
  'user',
] as const satisfies readonly IconName[];

const ARTWORK: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="9" cy="9" r="5.2" />
      <path d="M12.9 12.9 16.6 16.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.8" />
      <path className="lms-icon-hand" d="M10 6.2V10l3.1 1.9" />
    </>
  ),
  lock: (
    <>
      <path className="lms-icon-shackle" d="M7.2 8.6V6.5a2.8 2.8 0 0 1 5.6 0v2.1" />
      <rect x="4.6" y="8.6" width="10.8" height="7.8" rx="2.2" />
      <path d="M10 11.9v1.6" />
    </>
  ),
  // One open end: the shackle leaves the air rather than closing on the body.
  unlock: (
    <>
      <path className="lms-icon-shackle" d="M7.2 8.6V6.5a2.8 2.8 0 0 1 5.5-.6" />
      <rect x="4.6" y="8.6" width="10.8" height="7.8" rx="2.2" />
      <path d="M10 11.9v1.6" />
    </>
  ),
  layers: (
    <>
      <path className="lms-icon-layer" d="M10 3.2 16.8 6.9 10 10.6 3.2 6.9Z" />
      <path className="lms-icon-layer" d="M3.2 10.6 10 14.3l6.8-3.7" />
      <path className="lms-icon-layer" d="M3.2 13.9 10 17.6l6.8-3.7" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M3.8 10h12.4" />
      <path d="m11.6 6.2 4.6 3.8-4.6 3.8" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="7.4" r="3.3" />
      <path d="M4.4 16.6c0-2.7 2.5-4.4 5.6-4.4s5.6 1.7 5.6 4.4" />
    </>
  ),
};

export type IconSize = 'sm' | 'md';

const SIZE: Record<IconSize, string> = {
  /** Beside `label`-sized text and inside a field's trailing slot. */
  sm: 'size-3.5',
  /** The default: beside body text. */
  md: 'size-4',
};

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /**
   * Only when the glyph carries something the surrounding words do not —
   * "Behind enrollment" on a lock in a row that names no state. Left out, the
   * icon is decoration and assistive tech skips it, which is what a glyph next
   * to its own label wants.
   */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 'md', label, className }: IconProps) {
  return (
    <svg
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      data-icon={name}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('lms-icon shrink-0', `lms-icon-${name}`, SIZE[size], className)}
    >
      {ARTWORK[name]}
    </svg>
  );
}
