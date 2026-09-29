import { getZoneParts, isValidIanaTimeZone } from '@lms/shared';

/**
 * When something happened, in the clock of whoever is reading the desk.
 *
 * `action_log.created_at` is an instant, and an instant has no local face until somebody asks for
 * one — so the answer is the operator's own zone when the account names a valid one, and the
 * browser's when it does not. An operator comparing a row against a log line is reading two systems
 * that both store UTC, and the only reason this screen translates at all is that a human is the one
 * checking whether two times line up.
 */

const CACHE = new Map<string, Intl.DateTimeFormat>();

/** The zone the reader is actually in, when the account cannot name one it trusts. */
function zoneFor(timeZone?: string | null): string {
  return timeZone && isValidIanaTimeZone(timeZone)
    ? timeZone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatterFor(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let formatter = CACHE.get(key);
  if (!formatter) {
    formatter = build();
    CACHE.set(key, formatter);
  }
  return formatter;
}

/** `Mon 28 Sept, 09:15` — the day and the minute, in the one string a log row is worth. */
export function formatInstant(instant: string, timeZone?: string | null): string {
  const zone = zoneFor(timeZone);
  const { hour, minute } = getZoneParts(instant, zone);
  const day = formatterFor(
    `instant-day:${zone}`,
    () =>
      new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: zone,
      }),
  ).format(new Date(instant));
  return `${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** `28 Sept 2026`, for a fact that is a day rather than a minute. */
export function formatDay(instant: string, timeZone?: string | null): string {
  const zone = zoneFor(timeZone);
  return formatterFor(
    `day:${zone}`,
    () =>
      new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: zone,
      }),
  ).format(new Date(instant));
}
