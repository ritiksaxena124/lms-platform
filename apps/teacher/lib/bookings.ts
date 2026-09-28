import type { Booking, BookingRequest, BookingRoomResponse } from '@lms/shared';

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

/**
 * Every class on the teacher's schedule, including the ones that are over.
 *
 * The API answers soonest-first, and this client neither re-sorts nor trims: what counts as
 * upcoming is the screen's decision, and the same list read from the student's side has to be
 * cut the same way.
 */
export async function listClasses(): Promise<BookingRequest[]> {
  const { bookings } = await apiJson<{ bookings: BookingRequest[] }>(`${path()}/classes`);
  return bookings;
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

/**
 * Ask for the room of a live class, and get its address.
 *
 * A post, not a read: the address is a key whose only lock is being hard to guess, so it is
 * handed to the API one checked person at a time rather than sitting on a list a browser caches,
 * prefetches and writes into history (ARCHITECTURE §6). It is returned as a bare string for the
 * same reason — a response object that outlives the room it names is another copy of the secret.
 */
export async function joinRoom(id: string): Promise<string> {
  const { room } = await apiJson<BookingRoomResponse>(`${path(id)}/room`, { method: 'POST' });
  return room.url;
}
