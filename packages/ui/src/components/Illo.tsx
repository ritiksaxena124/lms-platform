import { cn } from '../lib/cn';

export type IlloSize = 'sm' | 'md' | 'lg';

const SIZE: Record<IlloSize, string> = {
  sm: 'h-24',
  md: 'h-36',
  lg: 'h-52',
};

export interface IlloProps {
  /** Root-relative path, e.g. `/illustrations/peep-sitting-01.svg`. */
  src: string;
  /** Height of the figure; the artwork keeps its own aspect ratio. */
  size?: IlloSize;
  /**
   * Only supply this when the drawing carries information the text does not.
   * Without it the figure is hidden from assistive tech, which is the point of
   * a decorative illustration.
   */
  label?: string;
  className?: string;
}

/**
 * A hand-drawn character from the Open Peeps set (CC0), sized against the type
 * scale rather than the viewport, so an empty state can never eat a screen.
 *
 * The figure is a block with a fixed height: the browser reserves the slot
 * before the SVG decodes, which keeps the reveal animation from reflowing.
 */
export function Illo({ src, size = 'md', label, className }: IlloProps) {
  return (
    <figure
      aria-hidden={label ? undefined : 'true'}
      className={cn('flex shrink-0 items-end justify-center', SIZE[size], className)}
    >
      <img
        src={src}
        alt={label ?? ''}
        width={200}
        height={400}
        loading="lazy"
        className={cn('h-full w-auto object-contain', !label && 'pointer-events-none')}
      />
    </figure>
  );
}
