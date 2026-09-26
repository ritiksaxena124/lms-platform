/**
 * The enrollment wire contract: a student's place in one course.
 *
 * A place is taken once and never destroyed. `POST /enrollments` is idempotent — the same
 * pair pressed twice answers with the one row that already exists rather than a conflict —
 * so `enrolledAt` is the day the student first came, not the day they last pressed the
 * button. Leaving sets `isActive` false and keeps the row, because that row is the reason
 * they could read the pages they already worked through.
 *
 * The course travels inside the row, as much of it as a list has to link to and name. A
 * student's list is not a catalog: it holds only places whose course is still on the shelf,
 * so nothing on the screen leads to a page that will not open.
 */

/** The course a place is in, in the three fields a student needs to recognise it. */
export interface EnrollmentCourse {
  id: string;
  slug: string;
  title: string;
}

export interface Enrollment {
  id: string;
  course: EnrollmentCourse;
  /** Whether the place is open right now. A closed row is a student who left, not a row
   * that was removed, and only the second reading survives a cancel. */
  isActive: boolean;
  /** When the place was first taken. Returning after leaving does not move it. */
  enrolledAt: string;
  updatedAt: string;
}

export interface EnrollmentResponse {
  enrollment: Enrollment;
}

export interface EnrollmentListResponse {
  items: Enrollment[];
}

/** The whole of what it takes to enroll: which course. There is no "as which student" —
 * the session answers that, and a body that could name somebody else would be a way to
 * take a place in a stranger's name. */
export interface CreateEnrollmentInput {
  courseId: string;
}
