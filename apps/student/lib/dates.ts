import { getZoneParts, isValidIanaTimeZone } from '@lms/shared';

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

/** The zone the reader is actually in, when the account cannot name one it trusts. */
function zoneFor(timeZone?: string | null): string {
  return timeZone && isValidIanaTimeZone(timeZone)
    ? timeZone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** `Thu 1 Oct`, named by the same locale that writes `formatDay`. */
function namedDay(instant: string, zone: string): string {
  const key = `day:${zone}`;
  let formatter = CACHE.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: zone,
    });
    CACHE.set(key, formatter);
  }
  return formatter.format(new Date(instant));
}

function clockFace(instant: string, zone: string): string {
  const { hour, minute } = getZoneParts(instant, zone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * When a class runs, on the clock of whoever is reading it: `Thu 1 Oct, 09:00–09:45`.
 *
 * The calendar that offered the minute was drawn in the teacher's zone; this is the same class
 * read in the student's, which is the one they set an alarm against. Twenty-four hour faces,
 * because that is how the teacher wrote the windows these classes were cut from.
 *
 * The day is read from the start alone. A class that runs across midnight says so in its own
 * faces (`23:30–00:15`), which is what a wall calendar does with it too.
 */
export function formatClassWindow(
  startsAt: string,
  endsAt: string,
  timeZone?: string | null,
): string {
  const zone = zoneFor(timeZone);
  return `${namedDay(startsAt, zone)}, ${clockFace(startsAt, zone)}–${clockFace(endsAt, zone)}`;
}
