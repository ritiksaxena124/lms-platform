import { Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  type CourseRosterEntry,
  type CourseRosterResponse,
  type CreateEnrollmentInput,
  type Enrollment,
} from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import type { EnrollmentRow, RosterRow } from './enrollments.repository';
import { EnrollmentsRepository } from './enrollments.repository';

/** A course is addressed by the id the catalog sent. A shape that cannot be one is refused
 * before Postgres is asked, because the database answers a malformed uuid with a syntax
 * error and that is a 500 about somebody's typo. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A class list is read on a screen, not exported, so a page is what fits on one. */
const DEFAULT_ROSTER_PAGE_SIZE = 25;

function toRosterEntry(row: RosterRow): CourseRosterEntry {
  return {
    student: { id: row.student.id, fullName: row.student.fullName },
    // The day the place was first taken, which a student who left and came back did not move.
    enrolledAt: row.createdAt.toISOString(),
  };
}

function toEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    course: {
      id: row.course.id,
      slug: row.course.slug,
      title: row.course.title,
    },
    isActive: row.isActive,
    // The day the place was first taken, not the day it was last reopened — the row was
    // never replaced, so the date never moved.
    enrolledAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A student's place in a course, and the only place in this app that writes one.
 *
 * Three rules decide everything below.
 *
 * Taking a place is idempotent. Pressing the button twice is one event: the second call
 * finds the row that already exists — open, or left behind when the student went away — and
 * answers with it rather than with a conflict or a duplicate. That is also why the route
 * replies `200` on a first enrollment instead of `201`: two status codes for one button
 * would ask the portal whether it had been clicked before.
 *
 * What a place is worth is decided by the catalog, not here. This service never lists a
 * lesson or opens a page; it writes the row that §11's query reads. The two published gates
 * stay in that one query, so enrolling cannot become a second place where the rules about
 * what is readable are kept.
 *
 * And a course nobody published cannot be joined, answered exactly like a course that was
 * never written. A `403` or a "that one is a draft" would be a way to walk a teacher's
 * unpublished work with a form.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly enrollments: EnrollmentsRepository,
    private readonly reference: ReferenceService,
  ) {}

  async enroll(studentUserId: string, input: CreateEnrollmentInput): Promise<Enrollment> {
    const published = await this.reference.valueId(
      LKP_TYPE_CODES.COURSE_STATUS,
      COURSE_STATUS_CODES.PUBLISHED,
    );
    const courseId = UUID.test(input.courseId)
      ? await this.enrollments.findEnrollableCourse(input.courseId, published)
      : null;

    if (!courseId) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that course.',
      });
    }

    const place = await this.enrollments.findPlace(studentUserId, courseId.id);
    // Reopening beats reinserting: the pair is unique, and the row that was already there
    // carries the day the student first arrived.
    return toEnrollment(
      place
        ? await this.enrollments.reactivate(place.id)
        : await this.enrollments.openPlace(studentUserId, courseId.id),
    );
  }

  /** The caller's own open places, newest first, and only in courses still on the shelf. */
  async list(studentUserId: string): Promise<Enrollment[]> {
    const published = await this.reference.valueId(
      LKP_TYPE_CODES.COURSE_STATUS,
      COURSE_STATUS_CODES.PUBLISHED,
    );
    const rows = await this.enrollments.listOpen(studentUserId, published);
    return rows.map(toEnrollment);
  }

  /**
   * Who holds a place in one of the caller's own courses.
   *
   * The other side of the pair, and the reason this read lives in a module the student writes
   * to: the table is the enrollment's, so both questions about it are kept where the row's
   * meaning is. Ownership is the whole permission — resolved against the courses the session
   * wrote, and a course that is not the caller's answers exactly like one nobody ever created.
   */
  async roster(
    teacherUserId: string,
    courseId: string,
    input: { page?: number; pageSize?: number },
  ): Promise<CourseRosterResponse> {
    const owned = UUID.test(courseId)
      ? await this.enrollments.findOwnedCourse(teacherUserId, courseId)
      : null;

    if (!owned) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that course.',
      });
    }

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? DEFAULT_ROSTER_PAGE_SIZE;
    const { rows, total } = await this.enrollments.listRoster(
      owned.id,
      (page - 1) * pageSize,
      pageSize,
    );

    return { items: rows.map(toRosterEntry), page, pageSize, total };
  }

  /**
   * Leave a place, or note that it is already left.
   *
   * A second cancel is not an error the portal has to explain, so an already-closed row is
   * returned as it is rather than refused. The row itself stays: it is the record of an
   * access that happened, and the pages read under it were opened by this enrollment.
   */
  async cancel(studentUserId: string, id: string): Promise<Enrollment> {
    const place = UUID.test(id) ? await this.enrollments.findOwnPlace(studentUserId, id) : null;

    if (!place) {
      // Somebody else's place and a place never taken are one answer: which enrollments
      // exist is not a fact about the caller.
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that enrollment.',
      });
    }

    return toEnrollment(place.isActive ? await this.enrollments.close(place.id) : place);
  }
}
