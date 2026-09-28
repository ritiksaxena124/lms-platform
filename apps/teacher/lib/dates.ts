import { getZoneParts, isValidIanaTimeZone } from '@lms/shared';

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
 * Twenty-four hours because that is how the same teacher wrote the windows these classes are cut
 * from — a queue reading "9:00 am" under a grid drawn "09:00–11:00" is two dialects for one set
 * of numbers, and the second is the easier one to turn up an hour late for.
 *
 * The day is read from the start alone. A class that runs across midnight says so in its own
 * faces (`23:30–00:15`), which is the same thing a wall calendar does with it.
 */
export function formatClassWindow(
  startsAt: string,
  endsAt: string,
  timeZone?: string | null,
): string {
  const zone = zoneFor(timeZone);
  return `${namedDay(startsAt, zone)}, ${clockFace(startsAt, zone)}–${clockFace(endsAt, zone)}`;
}

/**
 * One instant, in the same dialect as the window a class is written in: `Mon 5 Oct, 09:25`.
 *
 * The live class door opens before the first minute, and a row that said "09:25" beside a window
 * reading `09:30–10:15` would be two formats for the one clock the teacher wrote both from.
 */
export function formatInstant(instant: string, timeZone?: string | null): string {
  const zone = zoneFor(timeZone);
  return `${namedDay(instant, zone)}, ${clockFace(instant, zone)}`;
}
