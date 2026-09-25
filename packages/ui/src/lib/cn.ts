import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Single entry point for class names in this package.
 *
 * `twMerge` runs after `clsx` so a call site can override a primitive's spacing
 * (`cn(buttonStyles, 'px-8')`) without leaving two padding utilities fighting in
 * the class list.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
