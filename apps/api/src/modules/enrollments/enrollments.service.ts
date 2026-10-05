import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ACTION_CODES,
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  MAIL_EVENT_CODES,
  PAYMENT_STATUS_CODES,
  type CourseRosterEntry,
  type CourseRosterResponse,
  type CreateEnrollmentInput,
  type Enrollment,
  type EnrollmentPayment,
  type PaymentStatusCode,
  type PlaceResponse,
} from '@lms/shared';

import { ActionRecorder } from '../action-log/action-recorder';
import { ReferenceService } from '../../reference/reference.service';
import { MailQueue } from '../notifications/mail-queue.service';
import { CouponService } from '../coupons/coupon.service';
import { PAYMENT, type PaymentProvider } from '../../providers/payment/payment.port';
import type { EnrollmentNews } from '../notifications/mail-queue.service';
import type {
  LedgerWrite,
  PaymentRow,
  PaymentStatuses,
  PlaceNewsRow,
  PlaceWithAttempt,
} from './enrollments.repository';
import type { EnrollmentRow, RosterRow } from './enrollments.repository';
import { EnrollmentsRepository } from './enrollments.repository';

/** A course is addressed by the id the catalog sent. A shape that cannot be one is refused
 * before Postgres is asked, because the database answers a malformed uuid with a syntax
 * error and that is a 500 about somebody's typo. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A class list is read on a screen, not exported, so a page is what fits on one. */
const DEFAULT_ROSTER_PAGE_SIZE = 25;

/** The course a press names, as far as this service reads it: the gate, and the price. */
type EnrollableCourse = NonNullable<
  Awaited<ReturnType<EnrollmentsRepository['findEnrollableCourse']>>
>;

/** What a press owes, in the ids the ledger stores, or `null` for a place that owes nothing.
 *
 * `null` and `0` are deliberately different. A course with no price has no money question at all, so
 * no row stands against it; a coupon that brought a price to nothing *was* a money question and was
 * answered by arithmetic, and the code that did it has to be traceable. */
type Quotation = Omit<LedgerWrite, 'statusValueId'> | null;

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

/** The ledger row as the student is told about it.
 *
 * `error` is the name on the wire for the column the table calls `providerError`, because what the
 * student reads is not a provider's own object — it is this platform's answer to "why not". */
function toPayment(row: PaymentRow | null): EnrollmentPayment | null {
  if (!row) return null;
  return {
    id: row.id,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency.code,
    status: row.status.code as PaymentStatusCode,
    providerReference: row.providerReference,
    error: row.providerError,
  };
}

/** The two halves of one answer: the place as it stands, and what the ledger says about it. */
function toPlace(row: PlaceWithAttempt): PlaceResponse {
  return { enrollment: toEnrollment(row.place), payment: toPayment(row.payment) };
}

/** The course's own price, in the ids a ledger row carries, or `null` where the shelf shows no
 * price at all.
 *
 * The two halves of a price are written together by the course endpoint — an amount over no currency
 * is a number a student cannot read — so a row with one half and not the other is read here as the
 * free course it is one step away from being, rather than as a quote with a blank in it. */
function listPrice(
  course: EnrollableCourse,
): Omit<LedgerWrite, 'couponId' | 'statusValueId'> | null {
  if (!course.priceMinorUnits || !course.priceCurrency) return null;
  return {
    amountMinorUnits: course.priceMinorUnits,
    currencyValueId: course.priceCurrency.id,
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

/** `PAYMENT_PROVIDER=none` is a deployment rather than a fault, and this is the one place its
 * student-facing answer is written.
 *
 * The live-class port answers the same configuration with a conflict, because a class on a box with
 * no rooms still stands and still happens. Nothing stands here: the place cannot open without money
 * and this platform cannot ask for money, so the honest answer is that the service the press needs
 * is not on this box — which is also why the refusal comes before the write, and why a student on a
 * `none` deployment never ends up holding a place that waits on a payment nobody can take. */
function takesNoMoney(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
    message: 'This platform is not wired to take a payment.',
  });
}

/** A place that never owed anything, answered to somebody who pressed pay on it. */
function nothingOwed(): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.BAD_REQUEST,
    message: 'That place never owed anything.',
  });
}

/**
 * A student's place in a course, and the only place in this app that writes one.
 *
 * Four rules decide everything below.
 *
 * Taking a place is idempotent. Pressing the button twice is one event: the write below finds the
 * row that already exists — open, closed, or already standing behind a payment — and answers with it
 * rather than with a conflict or a duplicate. That is also why the route replies `200` on a first
 * enrollment instead of `201`: two status codes for one button would ask the portal whether it had
 * been clicked before. It is the same reason a replay files no news at the bottom of this file.
 *
 * A place opens when the money for it arrives, not when it is asked for. A course with a price holds
 * its place shut and files a `pending` attempt; the `POST /enrollments/:id/pay` press below asks the
 * port, and the place opens on the answer. Nothing here pretends to have taken money — the ledger row
 * is written from the port's reply or from a price of zero, and never from a guess beside either.
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
    private readonly mail: MailQueue,
    private readonly actions: ActionRecorder,
    private readonly coupons: CouponService,
    @Inject(PAYMENT) private readonly payment: PaymentProvider,
  ) {}

  /**
   * Ask for a place, and open it if nothing stands between the student and it.
   *
   * The event is named here and filed by the repository: which of joining and reopening a write is
   * is vocabulary, and the queue only accepts a code, while *whether anything happened at all* is
   * settled by the statement that wrote the row. The two halves meet in a callback that runs inside
   * that statement's transaction (ARCHITECTURE §6).
   *
   * The record of the decision goes down the same road for the same reason, and reaches the same
   * places: a join that turns out to be a replay of a press leaves neither a letter nor a record
   * behind, because nothing happened that anybody was told about or needs to be able to read later.
   *
   * A held place gets neither. That is the difference between this write and the one before the
   * payment gate existed, when a `payment` row reading `completed` was filed beside a place that
   * opened immediately: the ledger claimed money had moved on a box that had never asked for any.
   */
  async enroll(studentUserId: string, input: CreateEnrollmentInput): Promise<PlaceResponse> {
    const published = await this.reference.valueId(
      LKP_TYPE_CODES.COURSE_STATUS,
      COURSE_STATUS_CODES.PUBLISHED,
    );
    const course = UUID.test(input.courseId)
      ? await this.enrollments.findEnrollableCourse(input.courseId, published)
      : null;

    if (!course) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that course.',
      });
    }

    const quote = await this.quoteFor(course, input.couponCode);
    const standing = await this.enrollments.findPlaceWithAttempt(studentUserId, course.id);

    // The money for this place already arrived, and the student left and came back. Nothing is
    // owed twice: the ledger row is the record of the payment for this enrollment, and leaving does
    // not unmake it — the same reason the row itself is never deleted.
    if (
      standing &&
      !standing.place.isActive &&
      standing.payment?.status.code === PAYMENT_STATUS_CODES.COMPLETED
    ) {
      return this.openPlace(studentUserId, course.id, null);
    }

    if (!quote) {
      return this.openPlace(studentUserId, course.id, null);
    }

    if (quote.amountMinorUnits === 0) {
      // A coupon brought the price to nothing, so the place opens on the arithmetic and the gateway
      // is never asked — there is no charge in a zero, and a port that reported collecting one would
      // be a ledger saying money moved when it did not.
      return this.openPlace(studentUserId, course.id, {
        ...quote,
        statusValueId: await this.statusValueId(PAYMENT_STATUS_CODES.COMPLETED),
      });
    }

    // Asked before anything is written, so a deployment that takes no money files no place waiting
    // on a payment that can never come.
    if (!this.payment.takesMoney) throw takesNoMoney();

    const held = await this.enrollments.holdPlace(studentUserId, course.id, {
      ...quote,
      statusValueId: await this.statusValueId(PAYMENT_STATUS_CODES.PENDING),
    });
    return toPlace(held);
  }

  /**
   * Answer for the money a held place owes, and open the place if it arrives.
   *
   * The attempt is asked about as it stands: the amount and the currency are read back off the ledger
   * row rather than recomputed from the course, so a teacher who re-priced the course after the
   * student was quoted is charged nothing — the quote the student saw is the number the gateway is
   * given, which is the only reading under which "the price I was shown" means anything.
   *
   * A refused charge is a `200` with a `failed` payment on it, not an error. It is a state the place
   * moved into, the same way a booking a teacher declines is, and a portal that had to unwrap a
   * failure envelope would be a portal guessing at which failures are errors. The place stays shut,
   * and the next press asks for a *new* row: the refusal happened and stays in the ledger, and a
   * retry that rewrote it would erase the fact that the money did not come the first time.
   *
   * The news and the record are filed by the write that opens the place, which on this road is the
   * settle — so a student is told they are in the course at the moment they are in it, and a press
   * that the gateway refused files no letter.
   */
  async pay(studentUserId: string, enrollmentId: string): Promise<PlaceResponse> {
    const current = UUID.test(enrollmentId)
      ? await this.enrollments.findOwnPlaceWithAttempt(studentUserId, enrollmentId)
      : null;

    if (!current) {
      // Somebody else's place and a place never taken are one answer: which enrollments
      // exist is not a fact about the caller.
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that enrollment.',
      });
    }

    const attempt = current.payment;
    if (!attempt) throw nothingOwed();

    // A settled attempt is reported, not re-asked. This is the double press of the pay button, and
    // the second one must not be a second charge or a second letter.
    if (attempt.status.code === PAYMENT_STATUS_CODES.COMPLETED) return toPlace(current);

    if (!this.payment.takesMoney) throw takesNoMoney();

    const statuses = await this.paymentStatuses();
    const target =
      attempt.status.code === PAYMENT_STATUS_CODES.PENDING
        ? attempt
        : await this.enrollments.mintAttempt(attempt, statuses.pending);

    const outcome = await this.payment.collect({
      id: target.id,
      amountMinorUnits: target.amountMinorUnits,
      currency: target.currency.code,
    });

    const settled = await this.enrollments.settleAttempt(
      target.id,
      outcome,
      statuses,
      (tx, row) => this.mail.aboutEnrollment(tx, MAIL_EVENT_CODES.ENROLLMENT_JOINED, toNews(row)),
      (tx, written) =>
        this.actions.record(tx, {
          action: ACTION_CODES.ENROLLMENT_JOINED,
          targetId: written.place.id,
          detail: { reopened: written.reopened },
        }),
    );

    return toPlace(settled);
  }

  /** The catalog's price with any coupon's arithmetic on top of it — the number the student is
   * quoted, in the ids the ledger stores, or `null` when the course carries no price at all.
   *
   * The coupon is validated against the course's own price rather than against a number the body
   * brought, because a body that could name an amount would be a student discounting themselves. */
  private async quoteFor(course: EnrollableCourse, couponCode?: string): Promise<Quotation> {
    const price = listPrice(course);
    if (!couponCode) return price ? { ...price, couponId: null } : null;

    if (!price) {
      throw new BadRequestException({
        code: API_ERROR_CODES.BAD_REQUEST,
        message: 'That course has no price to discount.',
      });
    }

    const validated = await this.coupons.validateAndCalculate(
      couponCode,
      course.id,
      price.amountMinorUnits,
      price.currencyValueId,
    );

    if (!('discountedAmount' in validated) || !validated.coupon) {
      throw new BadRequestException({
        code: API_ERROR_CODES.BAD_REQUEST,
        message:
          'error' in validated && validated.error
            ? validated.error
            : 'That coupon does not apply here.',
      });
    }

    return {
      amountMinorUnits: validated.discountedAmount,
      currencyValueId: price.currencyValueId,
      couponId: validated.coupon.id,
    };
  }

  /** Open the place, and let the repository file the news and the record inside the same statement
   * that wrote it. */
  private async openPlace(
    studentUserId: string,
    courseId: string,
    settled: LedgerWrite | null,
  ): Promise<PlaceResponse> {
    const opened = await this.enrollments.openPlace(
      studentUserId,
      courseId,
      settled,
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
    );
    return toPlace(opened);
  }

  /** The three states this service moves ledger rows between, read from the vocabulary table rather
   * than assumed from a column. */
  private async paymentStatuses(): Promise<PaymentStatuses> {
    const [pending, completed, failed] = await Promise.all([
      this.statusValueId(PAYMENT_STATUS_CODES.PENDING),
      this.statusValueId(PAYMENT_STATUS_CODES.COMPLETED),
      this.statusValueId(PAYMENT_STATUS_CODES.FAILED),
    ]);
    return { pending, completed, failed };
  }

  private statusValueId(code: PaymentStatusCode): Promise<string> {
    return this.reference.valueId(LKP_TYPE_CODES.PAYMENT_STATUS, code);
  }

  /** The caller's own open places, newest first, in the courses that still open for them — the
   * shelf, and a course their teacher paused while they were partway through it. */
  async list(studentUserId: string): Promise<Enrollment[]> {
    const [published, draft] = await Promise.all([
      this.reference.valueId(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.PUBLISHED),
      this.reference.valueId(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.DRAFT),
    ]);
    const rows = await this.enrollments.listOpen(studentUserId, published, draft);
    return rows.map(toEnrollment);
  }

  /** The caller's own places that are shut behind money, newest first — the read a reload makes when
   * the student is not in a course yet but has already asked to be.
   *
   * This is the same two questions `list` answers, asked of the other half of the table: which courses
   * still open, and which of the caller's rows are standing shut with an attempt against them. The
   * statuses are resolved here rather than in the repository because "owed, and not yet paid" is
   * vocabulary, and the row only stores ids. */
  async held(studentUserId: string): Promise<PlaceResponse[]> {
    const [published, draft, statuses] = await Promise.all([
      this.reference.valueId(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.PUBLISHED),
      this.reference.valueId(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.DRAFT),
      this.paymentStatuses(),
    ]);
    const rows = await this.enrollments.listHeld(studentUserId, published, draft, statuses);
    return rows.map(toPlace);
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
   *
   * A place whose money has not arrived needs no leaving — it was never open, and `isActive` has been
   * false since the press that asked for it.
   */
  async cancel(studentUserId: string, id: string): Promise<Enrollment> {
    const place = UUID.test(id) ? await this.enrollments.findOwnPlace(studentUserId, id) : null;

    if (!place) {
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
