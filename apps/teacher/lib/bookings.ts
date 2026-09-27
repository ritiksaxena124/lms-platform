import type { Booking, BookingRequest } from '@lms/shared';

import { apiJson } from './api';

/**
 * The teacher's side of a booking, across the wire.
 *
 * A request is read from the door it was addressed to, so nothing here names a teacher: the
 * session is the teacher, and a client that could name somebody else would let one colleague
 * answer another colleague's queue. The student's own list is a different route for the same
 * reason (§13).
 *
 * Confirming and refusing are two routes rather than one route carrying a status. They are not
 * two values of one edit — a yes keeps the minute held and a no gives it back to the calendar —
 * and a body a teacher could get wrong has no place in either.
 */

const path = (id?: string): string =>
  id === undefined ? '/bookings' : `/bookings/${encodeURIComponent(id)}`;

/** Only what is still waiting. An answered row is not a queue, and the schedule is its own read. */
export async function listRequests(): Promise<BookingRequest[]> {
  const { requests } = await apiJson<{ requests: BookingRequest[] }>(`${path()}/requests`);
  return requests;
}

export async function confirmRequest(id: string): Promise<Booking> {
  const { booking } = await apiJson<{ booking: Booking }>(`${path(id)}/confirm`, {
    method: 'POST',
  });
  return booking;
}

export async function refuseRequest(id: string): Promise<Booking> {
  const { booking } = await apiJson<{ booking: Booking }>(`${path(id)}/reject`, {
    method: 'POST',
  });
  return booking;
}
