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

/**
 * A student as a teacher's roster shows them: the name and the id the pair is keyed by.
 *
 * No email address. A roster answers "who is coming to class", and an address is the field a
 * list like this gains by convenience and never drops — the student id is here because two
 * people can share a name and the screen needs one of them to be a key.
 */
export interface RosterStudent {
  id: string;
  fullName: string;
}

/**
 * One open place in a course.
 *
 * There is no enrollment id: a teacher reads this list and does not act on rows in it. Leaving
 * is the student's decision, so giving the roster a primary key would be an invitation to build
 * the route that removes somebody's place for them.
 */
export interface CourseRosterEntry {
  student: RosterStudent;
  /** The day the place was first taken, which is not the day a student who left came back. */
  enrolledAt: string;
}

export interface CourseRosterResponse {
  items: CourseRosterEntry[];
  page: number;
  pageSize: number;
  /** Every open place in the course, not the ones on this page. */
  total: number;
}
