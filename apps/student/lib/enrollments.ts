import type {
  CreateEnrollmentInput,
  Enrollment,
  EnrollmentListResponse,
  EnrollmentResponse,
} from '@lms/shared';

import { apiGet, apiJson } from './api';

/**
 * The places this student holds, taken and left.
 *
 * Three calls and no local idea of what a place is: the roster is `GET /enrollments`, and the
 * two writes are the API's own verbs for joining and leaving. All three send the session, since
 * every one of them is scoped by it — there is no student id in any address or body, so a list
 * cannot be widened to somebody else's places and a cancel cannot reach a stranger's.
 *
 * Nothing here decides whether a button should appear. The roster comes back as it is, a failed
 * read throws like any other, and the screen keeps the choice of what to offer when it cannot
 * hear.
 */

/** Every course this student is inside, in the API's order. Unpaged on purpose: a student's
 * own shelf is not a search result, and a page of it would be a course they cannot see. */
export async function myPlaces(): Promise<Enrollment[]> {
  const { items } = await apiGet<EnrollmentListResponse>('/enrollments', '', {
    withSession: true,
  });
  return items;
}

/**
 * Take a place in one course.
 *
 * Idempotent at the far end: pressing this twice answers with the place that already exists,
 * with its original `enrolledAt`, so the caller never has to know whether it is the first time.
 */
export async function takePlace(courseId: string, couponCode?: string): Promise<Enrollment> {
  const input: CreateEnrollmentInput = { courseId, couponCode };
  const { enrollment } = await apiJson<EnrollmentResponse>('/enrollments', {
    method: 'POST',
    body: input,
    withSession: true,
  });
  return enrollment;
}

/** Close a place by its own id — not the course's, which is a different question. Leaving
 * keeps the row on the server; this list simply stops showing it. */
export async function leavePlace(enrollmentId: string): Promise<Enrollment> {
  const { enrollment } = await apiJson<EnrollmentResponse>(
    `/enrollments/${encodeURIComponent(enrollmentId)}/cancel`,
    { method: 'POST', withSession: true },
  );
  return enrollment;
}
