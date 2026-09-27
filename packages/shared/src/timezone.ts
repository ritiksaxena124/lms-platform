/**
 * Every instant crossing the API boundary is UTC. These helpers are the single place
 * a UTC instant becomes wall-clock text for a specific IANA timezone, so display rules
 * (and DST behaviour) cannot drift per screen. Scheduling math builds on the same
 * formatter to avoid ad-hoc `getHours()` usage, which reads the *server* zone.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

export interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatterFor(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = FORMATTER_CACHE.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', ...options });
    FORMATTER_CACHE.set(key, formatter);
  }
  return formatter;
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    formatterFor(timeZone, { year: 'numeric' }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function toUtcInstant(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Cannot read a UTC instant from ${String(value)}`);
  }
  return date;
}

export function getZoneParts(instant: Date | string | number, timeZone: string): ZoneParts {
  const parts = formatterFor(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(toUtcInstant(instant));

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

export interface FormattedInstant {
  time: string;
  date: string;
  weekday: string;
  dayOfMonth: number;
  month: string;
  zone: string;
  label: string;
}

export function formatInZone(
  instant: Date | string | number,
  timeZone: string,
  locale = 'en-IN',
): FormattedInstant {
  const date = toUtcInstant(instant);
  const { dayOfMonth, month, weekdayLabel, time, dateLabel } = {
    dayOfMonth: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone }).format(date),
    month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone }).format(date),
    weekdayLabel: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(date),
    time: new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(date),
    dateLabel: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone,
    }).format(date),
  };
  const zone = shortZoneLabel(date, timeZone);

  return {
    time,
    date: dateLabel,
    weekday: weekdayLabel,
    dayOfMonth: Number(dayOfMonth),
    month,
    zone,
    label: `${weekdayLabel}, ${dateLabel} · ${time} ${zone}`,
  };
}

/** `Asia/Kolkata` -> `GMT+5:30`; keeps ambiguous times honest about their offset. */
export function shortZoneLabel(instant: Date | string | number, timeZone: string): string {
  const date = toUtcInstant(instant);
  const parts = formatterFor(timeZone, { timeZoneName: 'shortOffset' }).formatToParts(date);
  const zonePart = parts.find((part) => part.type === 'timeZoneName')?.value;
  if (zonePart) return zonePart;
  const offsetMinutes = zoneOffsetMinutes(date, timeZone);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/**
 * The instant a zone's wall clock reads `minutes` past midnight on `localDate`.
 *
 * Two passes, because the offset is only knowable from an instant and the instant is what we
 * are looking for: the first guess uses the offset on the far side of the transition, the
 * second corrects it against the offset the guess actually lands in.
 *
 * The zone's own clock has the final word — a caller that needs certainty re-reads the result
 * with `getZoneParts` and compares. A skipped clock face (spring forward) resolves to an instant
 * that reads a *different* face, which is how the caller learns the minute never arrived; a
 * repeated one (fall back) resolves to whichever of the two passes the offset leads to, so the
 * same request always names the same instant.
 */
export function instantAtLocalMinutes(
  timeZone: string,
  localDate: LocalDate,
  minutes: number,
): Date {
  const wallClockAsUtc =
    Date.UTC(localDate.year, localDate.month - 1, localDate.day, 0, 0, 0) + minutes * 60_000;
  const guessed = wallClockAsUtc - zoneOffsetMinutes(new Date(wallClockAsUtc), timeZone) * 60_000;
  return new Date(wallClockAsUtc - zoneOffsetMinutes(new Date(guessed), timeZone) * 60_000);
}

export function zoneOffsetMinutes(instant: Date | string | number, timeZone: string): number {
  const date = toUtcInstant(instant);
  const parts = getZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}
