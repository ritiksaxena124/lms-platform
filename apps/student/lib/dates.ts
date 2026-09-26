import { isValidIanaTimeZone } from '@lms/shared';

/**
 * The one date format this portal shows a person about themselves.
 *
 * The catalog's own stamps ("updated 25 Sep 2026") stay inline in their components because they
 * describe a row's edit, not a reader's memory; this one is here because a place was taken on a
 * day, and the day only belongs to the student's timezone.
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
