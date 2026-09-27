/**
 * The booking contract: what a student is offered, and the class they take.
 *
 * Two shapes here answer two different questions, and both belong to the student's side of the
 * calendar. A slot is an *offer* — one instant inside the teacher's week that nobody has taken —
 * and a booking is the *answer* a student gave to one of those offers, which then waits for the
 * teacher to confirm it. The instants themselves are cut from availability rules by
 * `schedule.ts`; nothing in this file stores or recomputes them.
 */
import type { BookingStatusCode, BookingTypeCode } from './lookup-codes';

/**
 * How the caller relates to the course whose calendar they opened.
 *
 * `enrolled` is a student holding a place, so the teacher's whole week is theirs to book against.
 * `demo` is a student with no place, looking at a course whose teacher opened it to trial calls.
 * `none` is neither, and `denial` says why: an empty list is not an explanation, and the screen
 * has to offer different actions for "enroll first" and "you already tried this teacher".
 */
export const SLOT_ENTITLEMENT_CODES = {
  ENROLLED: 'enrolled',
  DEMO: 'demo',
  NONE: 'none',
} as const;

export type SlotEntitlementCode =
  (typeof SLOT_ENTITLEMENT_CODES)[keyof typeof SLOT_ENTITLEMENT_CODES];

/** Which of the two doors was shut. Only travels with an entitlement of `none`. */
export const SLOT_DENIAL_CODES = {
  ENROLLMENT_REQUIRED: 'enrollment_required',
  DEMO_ALREADY_TAKEN: 'demo_already_taken',
} as const;

export type SlotDenialCode = (typeof SLOT_DENIAL_CODES)[keyof typeof SLOT_DENIAL_CODES];

/** One class a student could take. Instants are UTC; the zone they read in is on the response. */
export interface OpenSlot {
  startsAt: string;
  endsAt: string;
}

export interface OpenSlotsResponse {
  course: { id: string; slug: string; title: string; demoBookingsEnabled: boolean };
  /** The grid is cut in the teacher's clock, so a student is told whose time they are reading. */
  teacher: { id: string; timezone: string };
  entitlement: SlotEntitlementCode;
  denial: SlotDenialCode | null;
  /** The range searched. A student who reloads an hour later gets a different list, and the two
   * bounds say which slice of the week this one is rather than pretending it is fixed. */
  from: string;
  to: string;
  slots: OpenSlot[];
}

/**
 * A class a student has asked for.
 *
 * `endsAt` is not stored — the table keeps a start and a length — but a screen that shows a
 * calendar square has to say when the class is over, and making three portals add sixty minutes
 * in three slightly different ways is how a lesson ends up finishing at two times.
 *
 * There is no student on it and no teacher either. A request is read from the door that owns it:
 * a student's own list needs no names on its rows, and the teacher's list of requests is a
 * separate shape that adds the student back, because that is the fact they are asking about.
 */
export interface Booking {
  id: string;
  /** Named rather than id-only, because the list a student reads is one row per course and a
   * screen that had to look the title up per row would be doing the join the query already has. */
  course: { id: string; slug: string; title: string };
  type: BookingTypeCode;
  status: BookingStatusCode;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  createdAt: string;
  updatedAt: string;
}
