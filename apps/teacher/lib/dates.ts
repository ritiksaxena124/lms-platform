import { isValidIanaTimeZone } from '@lms/shared';

/**
 * The one date format this portal shows a person about themselves.
 *
 * A roster row is a day, and a day belongs to whoever is reading it: the instant the API stores
 * is the same for both ends of a course, but "21 Sept" is only true in one of their zones.
 * Catalog stamps stay inline in their components because they describe a row's edit; this one
 * describes a person's decision.
 */

const CACHE = new Map<string, Intl.DateTimeFormat>();

export function formatDay(instant: string | Date, timeZone?: string | null): string {
  const zone = timeZone && isValidIanaTimeZone(timeZone) ? timeZone : null;
  const cacheKey = zone ?? 'browser';

  let formatter = CACHE.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(zone ? { timeZone: zone } : {}),
    });
    CACHE.set(cacheKey, formatter);
  }

  return formatter.format(new Date(instant));
}
