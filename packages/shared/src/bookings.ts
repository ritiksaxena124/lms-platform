/**
 * The booking contract: what a student is offered, and the class they take.
 *
 * Two shapes here answer two different questions, and both belong to the student's side of the
 * calendar. A slot is an *offer* — one instant inside the teacher's week that nobody has taken —
 * and a booking is the *answer* a student gave to one of those offers, which then waits for the
 * teacher to confirm it. The instants themselves are cut from availability rules by
 * `schedule.ts`; nothing in this file stores or recomputes them.
 */
import {
  BOOKING_STATUS_CODES,
  type BookingStatusCode,
  type BookingTypeCode,
} from './lookup-codes';

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

/**
 * What each booking status reads as to a person.
 *
 * A booking arrives with bare codes — `status` is a string, where a course carries its lookup
 * row's `{code, label}` pair — so every screen that lists classes has to supply the words, and
 * they have to be the same words. "Cancelled" on the teacher's list and "Called off" on the
 * student's is one fact said two ways, and the student is the one deciding whether they still
 * have a class on Thursday.
 *
 * The keys are the codes themselves, typed as `Record<BookingStatusCode, string>`: a status some
 * code can write that has no word here is a compile error and a failed shared test, not an
 * `undefined` printed in the middle of a calendar.
 */
export const BOOKING_STATUS_LABELS: Record<BookingStatusCode, string> = {
  [BOOKING_STATUS_CODES.PENDING]: 'Pending',
  [BOOKING_STATUS_CODES.CONFIRMED]: 'Confirmed',
  [BOOKING_STATUS_CODES.COMPLETED]: 'Completed',
  [BOOKING_STATUS_CODES.CANCELLED]: 'Cancelled',
  [BOOKING_STATUS_CODES.REJECTED]: 'Declined',
  [BOOKING_STATUS_CODES.EXPIRED]: 'Expired',
  [BOOKING_STATUS_CODES.NO_SHOW]: 'No show',
};

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

/**
 * A booking as the teacher reads it: the same class, plus the person asking.
 *
 * The name is the whole difference between this and `Booking`. A student deciding whether to keep
 * a class is reading their own calendar; a teacher deciding whether they can teach Thursday
 * evening is deciding about somebody, and a list of uuids would send them off to another screen to
 * find out who. It comes from the account rather than from a student-profile table because that is
 * the name the platform already shows a teacher, and it is stored on the booking's student rather
 * than copied onto the row — a person who changes their name is not a class that changed.
 *
 * Both teacher reads carry it. The queue of requests is the obvious one, and the class list is
 * the same fact a day later: six o'clock is somebody's lesson whether or not the answer to it is
 * still unwritten.
 */
export interface BookingRequest extends Booking {
  student: { id: string; displayName: string };
}
