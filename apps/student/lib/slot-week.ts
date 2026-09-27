import {
  BOOKING_STATUS_CODES,
  BOOKING_STATUS_LABELS,
  addLocalDays,
  formatInZone,
  getZoneParts,
  instantAtLocalMinutes,
  isoWeekdayOf,
  localDateKey,
  wallClock,
  weekdayLabel,
  zoneDateKey,
  zoneDateOf,
  type Booking,
  type BookingStatusCode,
  type LocalDate,
  type OpenSlotsResponse,
} from '@lms/shared';
import type { CalendarChip, CalendarChipTone, CalendarDay } from '@lms/ui';

/**
 * The grid a student books from: the instants the API searched, cut into weeks of seven columns.
 *
 * This sits apart from the screen because a calendar has two ways to be quietly wrong, and both
 * are arithmetic. A class at 19:00 UTC is a Monday morning in Kolkata and a Sunday evening in
 * London, so a column's day comes from the teacher's zone and nothing else; and the horizon the
 * server searched is thirty *days* rather than four weeks, so the last week is marked rather than
 * invented. Both mistakes look like a working calendar, and cost a student the class they thought
 * they had just booked.
 *
 * The `now` a caller passes is the moment its read settled, not a clock read here: a date worked
 * out during render is one instant on the server and another in the browser, and a grid whose
 * "today" moves between the two is a hydration bug with a friendly face.
 */

const NOON = 12 * 60;

/** The two statuses that still hold a minute. Anything else has given it back, or never took it. */
const HELD_STATUSES: readonly BookingStatusCode[] = [
  BOOKING_STATUS_CODES.PENDING,
  BOOKING_STATUS_CODES.CONFIRMED,
];

/** A held minute is the student's, so it is drawn as a fact rather than as something to press. */
function heldTone(status: BookingStatusCode): CalendarChipTone {
  return status === BOOKING_STATUS_CODES.CONFIRMED ? 'confirmed' : 'pending';
}

export interface SlotWeek {
  /** Names the grid to a keyboard user: `Week of 28 Sept`. */
  label: string;
  days: CalendarDay[];
}

export interface SlotWeekOptions {
  /** The minute the student is about to ask for, which is drawn in the chosen colour and stays
   * pressable, so a second tap moves the choice rather than clearing it. */
  selected?: string | null;
  /**
   * What the screen does when an open minute is pressed. With no handler every chip is static
   * text — which is the point: a grid nobody can act on must not look like it can be.
   */
  onSelect?: ((startsAt: string) => void) | null;
}

/** A chip and the instant it sorts by, kept together so a column reads down in time order. */
interface Dated {
  at: number;
  chip: CalendarChip;
}

/** The Monday a date is inside, so the first column is where a week starts rather than where the
 * horizon happened to open. */
function mondayOf(date: LocalDate): LocalDate {
  return addLocalDays(date, -(isoWeekdayOf(date) - 1));
}

/** A clock face in the zone the grid is read in. */
function face(instant: Date, timeZone: string): string {
  const { hour, minute } = getZoneParts(instant, timeZone);
  return wallClock(hour * 60 + minute);
}

function windowLabel(startsAt: Date, endsAt: Date, timeZone: string): string {
  return `${face(startsAt, timeZone)}–${face(endsAt, timeZone)}`;
}

/** The day a date is on, as a column header reads it: `28 Sep`. */
function dateLabel(date: LocalDate, timeZone: string): string {
  const { dayOfMonth, month } = formatInZone(
    instantAtLocalMinutes(timeZone, date, NOON),
    timeZone,
  );
  return `${dayOfMonth} ${month}`;
}

function fullDateLabel(date: LocalDate, timeZone: string): string {
  return `${weekdayLabel(isoWeekdayOf(date))} ${dateLabel(date, timeZone)}`;
}

function ariaLabel(startsAt: Date, endsAt: Date, timeZone: string): string {
  return `${fullDateLabel(zoneDateOf(startsAt, timeZone), timeZone)}, ${face(startsAt, timeZone)} to ${face(endsAt, timeZone)}`;
}

/**
 * Chips collected by the column they belong to.
 *
 * A held booking wins over the open slot on the same minute: the read that offered that minute is
 * a moment old, and by the time its chip is drawn the student may well be the reason it is gone.
 */
function chipsByDay(
  response: OpenSlotsResponse,
  bookings: Booking[],
  options: SlotWeekOptions,
): Map<string, Dated[]> {
  const zone = response.teacher.timezone;
  const selected = options.selected ?? null;
  const onSelect = options.onSelect ?? null;
  const byDay = new Map<string, Dated[]>();

  const held = new Map<string, Booking>();
  for (const booking of bookings) {
    const keepsTheMinute =
      booking.course.id === response.course.id && HELD_STATUSES.includes(booking.status);
    if (keepsTheMinute && !held.has(booking.startsAt)) held.set(booking.startsAt, booking);
  }

  const push = (startsAt: Date, endsAt: Date, chip: CalendarChip): void => {
    const key = zoneDateKey(startsAt, zone);
    const entry = { at: startsAt.getTime(), chip };
    const list = byDay.get(key);
    if (list) list.push(entry);
    else byDay.set(key, [entry]);
  };

  for (const booking of held.values()) {
    const startsAt = new Date(booking.startsAt);
    const endsAt = new Date(booking.endsAt);
    push(startsAt, endsAt, {
      id: `booking-${booking.id}`,
      label: windowLabel(startsAt, endsAt, zone),
      tone: heldTone(booking.status),
      ariaLabel: `${ariaLabel(startsAt, endsAt, zone)} · your class, ${BOOKING_STATUS_LABELS[booking.status]}`,
    });
  }

  for (const slot of response.slots) {
    // Already on the grid as the student's own, so it is not also an offer.
    if (held.has(slot.startsAt)) continue;
    const startsAt = new Date(slot.startsAt);
    const endsAt = new Date(slot.endsAt);
    push(startsAt, endsAt, {
      id: slot.startsAt,
      label: windowLabel(startsAt, endsAt, zone),
      tone: slot.startsAt === selected ? 'selected' : 'available',
      ariaLabel: ariaLabel(startsAt, endsAt, zone),
      // The one place a chip becomes a control: an open minute, and only when the screen said
      // what to do with it.
      ...(onSelect ? { onSelect: () => onSelect(slot.startsAt) } : {}),
    });
  }

  for (const chips of byDay.values()) chips.sort((a, b) => a.at - b.at);
  return byDay;
}

export function buildSlotWeeks(
  response: OpenSlotsResponse,
  bookings: Booking[],
  now: number,
  options: SlotWeekOptions = {},
): SlotWeek[] {
  const zone = response.teacher.timezone;
  const firstDate = zoneDateOf(response.from, zone);
  // The horizon's end is exclusive, so the last day a class can start on is the instant before it.
  const lastDate = zoneDateOf(new Date(Date.parse(response.to) - 1), zone);
  const firstKey = localDateKey(firstDate);
  const lastKey = localDateKey(lastDate);
  const todayKey = zoneDateKey(new Date(now), zone);
  const dated = chipsByDay(response, bookings, options);

  const weeks: SlotWeek[] = [];
  for (
    let monday = mondayOf(firstDate);
    localDateKey(monday) <= lastKey;
    monday = addLocalDays(monday, 7)
  ) {
    const days: CalendarDay[] = [];

    for (let index = 0; index < 7; index += 1) {
      const date = addLocalDays(monday, index);
      const key = localDateKey(date);
      const outside = key < firstKey || key > lastKey;
      const chips = (dated.get(key) ?? []).map((entry) => entry.chip);

      days.push({
        key,
        weekday: weekdayLabel(isoWeekdayOf(date)).slice(0, 3),
        date: dateLabel(date, zone),
        state: outside ? 'outside' : key === todayKey ? 'today' : 'default',
        chips,
        ...(!outside && chips.length === 0 ? { empty: 'No classes' } : {}),
      });
    }

    weeks.push({ label: `Week of ${dateLabel(monday, zone)}`, days });
  }

  return weeks;
}
