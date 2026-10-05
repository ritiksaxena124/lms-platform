import type {
  CreateEnrollmentInput,
  Enrollment,
  EnrollmentListResponse,
  EnrollmentResponse,
  HeldPlaceListResponse,
  PlaceResponse,
} from '@lms/shared';

import { apiGet, apiJson } from './api';

/**
 * The places this student holds, taken and left.
 *
 * Five calls and no local idea of what a place is: the two reads are `GET /enrollments` and
 * `GET /enrollments/held`, and the three writes are the API's own verbs for joining, paying for, and
 * leaving one. All five send the session, since every one of them is scoped by it — there is no
 * student id in any address or body, so a list cannot be widened to somebody else's places and
 * neither a cancel nor a pay can reach a stranger's.
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
 * The places that were asked for and have not opened, because their money has not arrived.
 *
 * The other half of {@link myPlaces}, and the reason a course page needs both: that call is a list
 * of links, and a place held behind money is not a link — so a student who pressed Enroll and then
 * reloaded would find no trace of their own hold, and the amount they had been quoted would only
 * come back by pressing again. Each item carries the attempt beside the place, which is what tells
 * a hold apart from a course the student left.
 */
export async function heldPlaces(): Promise<PlaceResponse[]> {
  const { items } = await apiGet<HeldPlaceListResponse>('/enrollments/held', '', {
    withSession: true,
  });
  return items;
}

/**
 * Take a place in one course.
 *
 * Idempotent at the far end: pressing this twice answers with the place that already exists,
 * with its original `enrolledAt`, so the caller never has to know whether it is the first time.
 *
 * The answer is the pair the API sends, not just the place. A priced course holds the place shut
 * until its money arrives, and the only thing that tells a held place from a left one is the
 * attempt beside it — `isActive: false` on its own is both.
 */
export async function takePlace(courseId: string, couponCode?: string): Promise<PlaceResponse> {
  const input: CreateEnrollmentInput = { courseId, couponCode };
  return apiJson<PlaceResponse>('/enrollments', {
    method: 'POST',
    body: input,
    withSession: true,
  });
}

/**
 * Answer for the money a held place owes.
 *
 * A press with no body: the amount and the currency are what this platform already wrote on the
 * ledger row, so there is nothing to send and a number sent from a browser would be a student
 * choosing their own price. Idempotent in the same direction as {@link takePlace} — a second
 * press on a charge that came back reports that charge rather than asking again.
 *
 * A refused charge resolves. It is a state the place moved into, with a reason worth printing,
 * not a request that failed.
 */
export async function payForPlace(enrollmentId: string): Promise<PlaceResponse> {
  return apiJson<PlaceResponse>(`/enrollments/${encodeURIComponent(enrollmentId)}/pay`, {
    method: 'POST',
    withSession: true,
  });
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
