import type { Booking, OpenSlotsResponse } from '@lms/shared';

import { apiGet, apiJson } from './api';

/**
 * The student's side of a teacher's calendar: what is free, what is asked for, what is booked.
 *
 * Two reads and two writes, and none of them carries a student id. The session is the identity
 * on every route here, which is the only way a list of "my classes" cannot be widened into
 * somebody else's by a changed query string.
 *
 * What a slot *means* — whether this person may take it, and if not why — is the API's answer,
 * delivered as the `entitlement` and `denial` on the response. Nothing here re-derives it from
 * the length of `slots`: an empty grid is what a teacher who keeps no windows looks like too, and
 * a client that guessed from the count would tell a student to enroll in a course they are in.
 */

/**
 * The classes this course is offering the reader, with the reason it is or is not offering them.
 *
 * `course` accepts an id or a slug, which is why it is encoded rather than interpolated — the
 * slug form is reader-supplied text on the way back from a link.
 */
export async function openSlotsFor(course: string): Promise<OpenSlotsResponse> {
  return apiGet<OpenSlotsResponse>(
    '/bookings/slots',
    `?course=${encodeURIComponent(course)}`,
    { withSession: true },
  );
}

/**
 * Ask for one of those minutes.
 *
 * The answer is a `pending` class, not a booked one: the hold is what this write buys, and the
 * teacher has not been asked yet. A second press for the same minute replays the same row with
 * the same `200`, so a double click on a slow connection is one request with one outcome.
 */
export async function bookSlot(course: string, startsAt: string): Promise<Booking> {
  const { booking } = await apiJson<{ booking: Booking }>('/bookings', {
    method: 'POST',
    body: { course, startsAt },
    withSession: true,
  });
  return booking;
}

/** Every class this student has asked for or holds, soonest first — the whole calendar, not one
 * course's slice of it. A screen that wants one course filters the list it was given. */
export async function myBookings(): Promise<Booking[]> {
  const { bookings } = await apiGet<{ bookings: Booking[] }>('/bookings', '', {
    withSession: true,
  });
  return bookings;
}

/**
 * Let go of a class, and hand its minute back to the teacher's calendar.
 *
 * Nothing is sent but the id: there is no field here a student could get wrong, and pressing it
 * twice answers `200` both times, because the second press is asking for a state the class is
 * already in. A class that has been taught, missed, refused or left to expire is the one thing
 * this cannot undo, and that comes back as a conflict.
 */
export async function leaveClass(id: string): Promise<Booking> {
  const { booking } = await apiJson<{ booking: Booking }>(
    `/bookings/${encodeURIComponent(id)}/cancel`,
    { method: 'POST', withSession: true },
  );
  return booking;
}
