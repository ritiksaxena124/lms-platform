import type { TeachingClassesResponse } from '@lms/shared';

import { apiJson } from './api';

/**
 * The teacher's dated classes, across the wire.
 *
 * One read, no teacher in it: the session is the teacher, and a client that could name somebody
 * else would be a way to read a colleague's term in their absence. The route is separate from the
 * booked classes under `/bookings` for the same reason the two tables are — a class the course
 * scheduled is not a class a person asked for, and the second has a queue in front of it that this
 * one has never seen (§Stage 2).
 *
 * No window is asked for either. The sweep keeps a horizon, and how far a calendar is stood behind
 * is the platform's answer rather than this portal's opinion; a client that guessed at thirty days
 * would put a second copy of that number here, and the two would drift apart. The bounds come back
 * on the response, which is what tells a screen whether it ran out of classes or out of calendar.
 */
export async function myTeachingClasses(): Promise<TeachingClassesResponse> {
  return apiJson<TeachingClassesResponse>('/classes/teaching');
}
