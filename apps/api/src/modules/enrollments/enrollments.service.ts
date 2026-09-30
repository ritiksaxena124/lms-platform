import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  ACTION_CODES,
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  DISCOUNT_TYPE_CODES,
  LKP_TYPE_CODES,
  MAIL_EVENT_CODES,
  PAYMENT_STATUS_CODES,
  type CourseRosterEntry,
  type CourseRosterResponse,
  type CreateEnrollmentInput,
  type Enrollment,
} from '@lms/shared';

import { ActionRecorder } from '../action-log/action-recorder';
import { ReferenceService } from '../../reference/reference.service';
import { MailQueue } from '../notifications/mail-queue.service';
import { CouponService } from '../coupons/coupon.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { EnrollmentNews } from '../notifications/mail-queue.service';
import type { EnrollmentRow, PlaceNewsRow, RosterRow } from './enrollments.repository';
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

/** The written row as a news story, which is a narrower thing than the row.
 *
 * The teacher's name is in it because the joining copy says who the student is now learning with,
 * and the student's id is in it because that is who has to be told. Their address is not: 6a's port
 * reads the address book at delivery time, so a person who changes it does not change a letter that
 * is already queued. */
function toNews(row: PlaceNewsRow): EnrollmentNews {
  return {
    course: {
      id: row.course.id,
      title: row.course.title,
      teacherName: row.course.teacher.fullName,
    },
    student: { id: row.studentUserId },
  };
}

/**
 * A student's place in a course, and the only place in this app that writes one.
 *
 * Three rules decide everything below.
 *
 * Taking a place is idempotent. Pressing the button twice is one event: the write below finds the
 * row that already exists — open, or left behind when the student went away — and answers with it
 * rather than with a conflict or a duplicate. That is also why the route replies `200` on a first
 * enrollment instead of `201`: two status codes for one button would ask the portal whether it had
 * been clicked before. It is the same reason a replay files no news at the bottom of this file.
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
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsRepository,
    private readonly reference: ReferenceService,
    private readonly mail: MailQueue,
    private readonly actions: ActionRecorder,
    private readonly coupons: CouponService,
  ) {}

  /**
   * Take a place, and queue the news if taking it was news.
   *
   * The event is named here and filed by the repository: which of joining and reopening a write is
   * is vocabulary, and the queue only accepts a code, while *whether anything happened at all* is
   * settled by the statement that wrote the row. The two halves meet in a callback that runs inside
   * that statement's transaction (ARCHITECTURE §6).
   *
   * The record of the decision goes down the same road for the same reason, and reaches the same
   * places: a join that turns out to be a replay of a press leaves neither a letter nor a record
   * behind, because nothing happened that anybody was told about or needs to be able to read later.
   */
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

    // Validate coupon if provided
    let couponId: string | null = null;
    let paymentAmount: number | null = null;
    let currencyValueId: string | null = null;
    let paymentStatusValueId: string | null = null;

    if (input.couponCode) {
      // Get the course price from the database
      const courseWithPrice = await this.enrollments.getCoursePrice(courseId.id);
      
      if (!courseWithPrice) {
        throw new NotFoundException({
          code: API_ERROR_CODES.NOT_FOUND,
          message: 'We cannot find that course.',
        });
      }

      // Look up currency ID (use the first available for POC)
      const currencies = await this.prisma.lkpValue.findMany({
        where: { type: { code: LKP_TYPE_CODES.CURRENCY }, isActive: true },
        select: { id: true },
        take: 1,
      });
      
      if (currencies.length === 0 || !currencies[0]) {
        throw new BadRequestException({
          code: API_ERROR_CODES.INTERNAL_ERROR,
          message: 'No currency configured.',
        });
      }
      currencyValueId = currencies[0].id;

      // Look up payment status ID for completed payments
      paymentStatusValueId = await this.reference.valueId(
        LKP_TYPE_CODES.PAYMENT_STATUS,
        PAYMENT_STATUS_CODES.COMPLETED,
      );

      // Validate coupon and calculate discounted price
      const validationResult = await this.coupons.validateAndCalculate(
        input.couponCode,
        courseId.id,
        courseWithPrice.priceMinorUnits,
        currencyValueId,
      );

      if (!validationResult.isValid) {
        throw new BadRequestException({
          code: API_ERROR_CODES.BAD_REQUEST,
          message: validationResult.error || 'Invalid coupon.',
        });
      }

      // TypeScript needs help narrowing the union here
      if (!('discountedAmount' in validationResult)) {
        throw new BadRequestException({
          code: API_ERROR_CODES.INTERNAL_ERROR,
          message: 'Coupon validation failed to calculate discount.',
        });
      }

      couponId = validationResult.coupon!.id;
      paymentAmount = validationResult.discountedAmount!;
    }

    const place = await this.enrollments.takePlace(
      studentUserId,
      courseId.id,
      (tx, row) => this.mail.aboutEnrollment(tx, MAIL_EVENT_CODES.ENROLLMENT_JOINED, toNews(row)),
      (tx, written) =>
        this.actions.record(tx, {
          action: ACTION_CODES.ENROLLMENT_JOINED,
          targetId: written.place.id,
          // Whose place this is, in which course, and since when are all columns of the row the
          // write moved. The one thing those do not say is whether this press opened a place or
          // reopened the one the student had left — which is the difference between a new face and a
          // returning one, and it stops being readable the moment the row says `isActive: true`.
          detail: { reopened: written.reopened },
        }),
      couponId,
      paymentAmount,
      currencyValueId,
      paymentStatusValueId,
    );
    return toEnrollment(place);
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
   * A second cancel is not an error the portal has to explain, so a place that is already closed is
   * returned as it is rather than refused. It is the same clause that files no news, and no record,
   * for it: the write below only matches a row that is still open, so leaving twice tells the student
   * they left once. The row itself stays: it is the record of an access that happened, and the pages
   * read under it were opened by this enrollment.
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

    const closed = await this.enrollments.closePlace(
      studentUserId,
      id,
      (tx, row) => this.mail.aboutEnrollment(tx, MAIL_EVENT_CODES.ENROLLMENT_LEFT, toNews(row)),
      // Nothing is named in `detail` because nothing was decided beyond the leaving: which place,
      // whose, and when it stopped being open are all on the row the write closed.
      (tx, row) =>
        this.actions.record(tx, {
          action: ACTION_CODES.ENROLLMENT_LEFT,
          targetId: row.id,
        }),
    );
    return toEnrollment(closed ?? place);
  }
}
