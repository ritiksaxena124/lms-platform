import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';
import type { PaymentOutcome } from '../../providers/payment/payment.port';

/** The course a place is in, enough of it to name the thing and link to it. */
const WITH_COURSE = {
  course: { select: { id: true, slug: true, title: true } },
} as const satisfies Prisma.EnrollmentInclude;

export type EnrollmentRow = Prisma.EnrollmentGetPayload<{ include: typeof WITH_COURSE }>;

/** The same row with the teacher on it, which is the only thing the news about a place needs that
 * a screen never shows.
 *
 * The two writes below answer with this rather than with `WITH_COURSE` because a joining message
 * names the person the student is about to learn with, and the name has to be read in the same
 * statement that decided the news — not looked up afterwards, when the course could answer
 * differently than it did while the write was open. */
const PLACE_NEWS_SELECT = {
  id: true,
  studentUserId: true,
  courseId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  course: {
    select: {
      id: true,
      slug: true,
      title: true,
      teacher: { select: { id: true, fullName: true } },
    },
  },
} as const satisfies Prisma.EnrollmentSelect;

export type PlaceNewsRow = Prisma.EnrollmentGetPayload<{ select: typeof PLACE_NEWS_SELECT }>;

/** The seam the bookings repository opened in the previous step, arriving on this side of the
 * relationship: *when* a place's news is filed belongs here, inside the transaction that moved the
 * row, while *which event* the write is belongs to the service, which owns the vocabulary.
 *
 * Called only on the road where the row changed. A student who takes a place they already hold is
 * the same press replayed, and a second letter telling them they are in a course they are already
 * in is the day they stop believing the queue. */
export type PlaceNotifier = (tx: Prisma.TransactionClient, row: PlaceNewsRow) => Promise<unknown>;

/** A place that just opened, and whether it had been closed.
 *
 * The record of a join is asked this and cannot answer it from the row: a reopened place keeps the
 * `createdAt` of the day the student first took it — which is the fact the response is built on — so
 * after the write there is nothing on the row to tell a new student apart from a returning one. The
 * read that decides which of the two writes to make already knows, so the answer travels to the
 * recorder rather than being guessed at by whoever reads the log later. */
export type PlaceRecord = { place: PlaceNewsRow; reopened: boolean };

/** The student a place belongs to, as little of them as a class list has to say. */
const WITH_STUDENT = {
  student: { select: { id: true, fullName: true } },
} as const satisfies Prisma.EnrollmentInclude;

export type RosterRow = Prisma.EnrollmentGetPayload<{ include: typeof WITH_STUDENT }>;

/** A ledger row, with the two names it is written against rather than their ids.
 *
 * The currency and the status are read through their relations because the wire contract speaks in
 * codes — `INR`, `pending` — and a row of uuids would make every caller ask the reference table the
 * same question again. The two ids travel beside the codes because a retry is written from the row
 * it retries: the new row needs the currency the refused one was quoted in, and reading it back off
 * the code would be a second lookup for a fact already in hand. */
const PAYMENT_SELECT = {
  id: true,
  enrollmentId: true,
  couponId: true,
  amountMinorUnits: true,
  currencyValueId: true,
  currency: { select: { code: true } },
  statusValueId: true,
  status: { select: { code: true } },
  providerReference: true,
  providerError: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

/** What a place is worth, once the catalog has been read and any coupon has been applied: the two
 * numbers a student is quoted, and the coupon that earned them, or `null` for a press with no code
 * on it.
 *
 * One object on purpose. The amount and the currency are halves of the same sentence, and a write
 * that could take a price without a currency would be a ledger row naming no money. */
export type PlaceQuote = {
  amountMinorUnits: number;
  currencyValueId: string;
  couponId: string | null;
};

/** A quote with the state it is being filed in, which is what the ledger actually stores. */
export type LedgerWrite = PlaceQuote & { statusValueId: string };

/** The three payment statuses this repository moves rows between, resolved by the service.
 *
 * Passed in rather than looked up here for the reason the course statuses are: the vocabulary of
 * which state a write is moving *to* belongs to the service, and a repository that read the lookup
 * table itself would be a second place where `pending` means something. */
export type PaymentStatuses = {
  pending: string;
  completed: string;
  failed: string;
};

/** The place, as the news about it is written, beside the attempt that stands against it — or
 * `null` where nothing is owed, which is the free course's whole answer.
 *
 * `payment` is the *newest* row, not the settled one: a place with a refused charge and a retry
 * waiting on it has two rows, and the press that asks about the place is told the state of the
 * question as it stands now. */
export type PlaceWithAttempt = { place: PlaceNewsRow; payment: PaymentRow | null };

/** The one read that carries both halves: the place, and the newest attempt ordered beside it.
 *
 * A nested `take: 1` rather than a second query, because "what does this place look like, and what
 * is it waiting for" is one question, and a repository that asked it in two statements would be one
 * statement away from answering it twice. */
const PLACE_WITH_ATTEMPT = {
  ...PLACE_NEWS_SELECT,
  payments: { orderBy: { createdAt: 'desc' }, take: 1, select: PAYMENT_SELECT },
} as const satisfies Prisma.EnrollmentSelect;

type PlaceWithAttemptRow = Prisma.EnrollmentGetPayload<{ select: typeof PLACE_WITH_ATTEMPT }>;

function toPlaceWithAttempt(row: PlaceWithAttemptRow): PlaceWithAttempt {
  const { payments, ...place } = row;
  return { place, payment: payments[0] ?? null };
}

/** The newest attempt on a place, from inside a transaction that has just written it. */
async function newestAttempt(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
): Promise<PaymentRow | null> {
  return tx.payment.findFirst({
    where: { enrollmentId },
    orderBy: { createdAt: 'desc' },
    select: PAYMENT_SELECT,
  });
}

/**
 * The table behind the student's place in a course.
 *
 * Every read and write is scoped by `studentUserId` in the `where` clause rather than checked
 * afterwards — the same rule the teacher's repositories run on, arriving on the other side of
 * the relationship. A place in somebody else's name and a place that was never taken answer
 * the same way, so no call can probe which enrollments exist.
 *
 * The writes that *open* a place each take a `notify` and call it inside their own transaction,
 * which is the outbox rule (ARCHITECTURE §6) in one sentence: the news is filed by the write that
 * made it, so a place whose row rolled back cannot have a letter about it waiting to send. Each takes
 * a `record` for the same moment and the same reason: Phase 7's log is the account of what the
 * platform did, and an account of a change that never committed is worse than no account at all.
 *
 * `holdPlace` takes neither, and that is the point of it. A place held behind money is not a place
 * anybody is in yet, so a letter announcing one would be the platform telling a student about a door
 * it has not opened.
 */
@Injectable()
export class EnrollmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The pair, active or not. A student who left is found here rather than treated as
   * nobody, because the row they left behind is the one that gets reopened. */
  async findPlace(studentUserId: string, courseId: string) {
    return this.prisma.enrollment.findUnique({
      where: { courseId_studentUserId: { courseId, studentUserId } },
      include: WITH_COURSE,
    });
  }

  /** The place, and whatever the ledger last said about it. `null` where the pair has never been
   * written, which is the only state in which nothing is owed and nothing is waiting. */
  async findPlaceWithAttempt(
    studentUserId: string,
    courseId: string,
  ): Promise<PlaceWithAttempt | null> {
    const row = await this.prisma.enrollment.findUnique({
      where: { courseId_studentUserId: { courseId, studentUserId } },
      select: PLACE_WITH_ATTEMPT,
    });
    return row ? toPlaceWithAttempt(row) : null;
  }

  /** The caller's place by its own id, with its newest attempt — the read behind a press of the pay
   * button, which has to answer about both halves at once. */
  async findOwnPlaceWithAttempt(
    studentUserId: string,
    id: string,
  ): Promise<PlaceWithAttempt | null> {
    const row = await this.prisma.enrollment.findFirst({
      where: { id, studentUserId },
      select: PLACE_WITH_ATTEMPT,
    });
    return row ? toPlaceWithAttempt(row) : null;
  }

  /**
   * Open a place, and say so once.
   *
   * Three roads, and only two of them are news. The student already holds it — the press is a
   * replay, and the row that answers is the one with the original `createdAt` on it, together with
   * whatever the ledger already said; a replay reads, it does not write. The row is there and closed
   * — reopened rather than replaced, because the pair is unique and the day the place was *first*
   * taken is a fact the student did not move by going away and coming back. Neither row is there —
   * the place is opened.
   *
   * `settled` is the row for a place that owes nothing and had a coupon on it: a discount that
   * brought the price to zero is written as `completed` with no reference, because the arithmetic is
   * the whole of what happened and the code was still spent. `null` is a plain free course, and files
   * no ledger row at all — a table of payments that were never questions would be a table nobody can
   * read.
   *
   * The read and the write are one transaction so that the news filed at the end describes the row
   * as it was written, and so a callback that throws takes the row back with it.
   */
  async openPlace(
    studentUserId: string,
    courseId: string,
    settled: LedgerWrite | null,
    notify: PlaceNotifier,
    record: WriteRecorder<PlaceRecord>,
  ): Promise<PlaceWithAttempt> {
    return this.prisma.$transaction(async (tx) => {
      const standing = await tx.enrollment.findUnique({
        where: { courseId_studentUserId: { courseId, studentUserId } },
        select: PLACE_NEWS_SELECT,
      });
      if (standing?.isActive) {
        return { place: standing, payment: await newestAttempt(tx, standing.id) };
      }

      const place = standing
        ? await tx.enrollment.update({
            where: { id: standing.id },
            data: { isActive: true },
            select: PLACE_NEWS_SELECT,
          })
        : await tx.enrollment.create({
            data: { studentUserId, courseId },
            select: PLACE_NEWS_SELECT,
          });

      const payment = settled ? await this.writeAttempt(tx, settled, place.id) : null;

      await notify(tx, place);
      await record(tx, { place, reopened: standing !== null });
      return { place, payment };
    });
  }

  /**
   * Hold a place shut behind money, and write the attempt that has to arrive.
   *
   * The place row exists from this moment — it is what the pay button is pressed against, and what
   * the student's own list will show them as not-yet-open — but `isActive` stays `false`, and the
   * pending row beside it is what tells "waiting on money" apart from "left". Nothing is filed to
   * the queue and nothing to the log: a letter saying *you are in the course* about a place that is
   * not open is the failure this whole write exists to prevent.
   *
   * Quoting is once per place. A second press finds the attempt already standing against the row and
   * answers with it — same id, same amount, no second redemption counted — because a student who
   * presses twice has asked the same question, and a ledger that grew a row per press would be a
   * ledger of how often people clicked.
   */
  async holdPlace(
    studentUserId: string,
    courseId: string,
    owed: LedgerWrite,
  ): Promise<PlaceWithAttempt> {
    return this.prisma.$transaction(async (tx) => {
      const standing = await tx.enrollment.findUnique({
        where: { courseId_studentUserId: { courseId, studentUserId } },
        select: PLACE_NEWS_SELECT,
      });
      if (standing) {
        // Anything already standing against this place is the answer, including a place that is
        // open: holding a place the student is inside of would be taking their door off its hinges
        // because the teacher re-priced the course after they joined.
        const attempt = await newestAttempt(tx, standing.id);
        if (attempt || standing.isActive) return { place: standing, payment: attempt };
      }

      const place =
        standing ??
        (await tx.enrollment.create({
          data: { studentUserId, courseId, isActive: false },
          select: PLACE_NEWS_SELECT,
        }));

      const payment = await this.writeAttempt(tx, owed, place.id);
      return { place, payment };
    });
  }

  /**
   * Put one attempt on the ledger, and count the coupon that earned it.
   *
   * Both halves in one statement pair because they are one fact: a discount that is written down
   * without being counted is a code that can be spent twice, and a count that moved without a row
   * beside it is a redemption nobody can point at. The increment is a write against the coupon row
   * inside the caller's transaction, which is what §13's count means by "maintained by the
   * enrollment endpoint".
   */
  private async writeAttempt(
    tx: Prisma.TransactionClient,
    write: LedgerWrite,
    enrollmentId: string,
  ): Promise<PaymentRow> {
    const payment = await tx.payment.create({
      data: {
        enrollmentId,
        couponId: write.couponId,
        amountMinorUnits: write.amountMinorUnits,
        currencyValueId: write.currencyValueId,
        statusValueId: write.statusValueId,
      },
      select: PAYMENT_SELECT,
    });

    if (write.couponId) {
      await tx.coupon.update({
        where: { id: write.couponId },
        data: { redemptionCount: { increment: 1 } },
      });
    }

    return payment;
  }

  /**
   * The next attempt on a place whose last one was refused.
   *
   * A new row rather than a rewrite of the refused one, which is the whole of what "append-only
   * ledger" means: the refusal happened, and the money somebody asked for a second time is a second
   * asking. The numbers are copied from the row that was refused — the student was quoted that
   * amount, and a retry that quietly costs more is not a retry.
   */
  async mintAttempt(refused: PaymentRow, pendingStatusValueId: string): Promise<PaymentRow> {
    return this.prisma.payment.create({
      data: {
        enrollmentId: refused.enrollmentId,
        couponId: refused.couponId,
        amountMinorUnits: refused.amountMinorUnits,
        currencyValueId: refused.currencyValueId,
        statusValueId: pendingStatusValueId,
      },
      select: PAYMENT_SELECT,
    });
  }

  /**
   * Write what the gateway answered onto the attempt it was asked about, and open the place if the
   * money arrived.
   *
   * The guard is on the row's own state — `statusValueId: pending` — rather than on a read before it,
   * so a second press that raced the first settles nothing twice and files no second letter. On that
   * road the call still answers: the row and its place as they now stand, because the person pressing
   * wants the state, not an error about who got there first.
   *
   * A `completed` opens the place inside the same transaction that wrote the answer, and that is the
   * gate this release is: there is no moment in which the ledger says the money arrived and the door
   * is still shut, and no moment in which the door is open on money that did not. `reopened` is
   * `false` on this road by construction — a place that opens by paying has never been open, since a
   * returning student whose money had already arrived is reopened by `openPlace` instead.
   */
  async settleAttempt(
    paymentId: string,
    outcome: PaymentOutcome,
    statuses: PaymentStatuses,
    notify: PlaceNotifier,
    record: WriteRecorder<PlaceRecord>,
  ): Promise<PlaceWithAttempt> {
    return this.prisma.$transaction(async (tx) => {
      const [settled] = await tx.payment.updateManyAndReturn({
        where: { id: paymentId, statusValueId: statuses.pending },
        data:
          outcome.status === 'completed'
            ? { statusValueId: statuses.completed, providerReference: outcome.providerReference }
            : { statusValueId: statuses.failed, providerError: outcome.error },
        select: PAYMENT_SELECT,
      });

      if (!settled) {
        const row = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          select: PAYMENT_SELECT,
        });
        const place = await tx.enrollment.findUniqueOrThrow({
          where: { id: row.enrollmentId },
          select: PLACE_NEWS_SELECT,
        });
        return { place, payment: row };
      }

      const place = await tx.enrollment.findUniqueOrThrow({
        where: { id: settled.enrollmentId },
        select: PLACE_NEWS_SELECT,
      });
      if (outcome.status !== 'completed') return { place, payment: settled };

      const [opened] = await tx.enrollment.updateManyAndReturn({
        where: { id: settled.enrollmentId, isActive: false },
        data: { isActive: true },
        select: PLACE_NEWS_SELECT,
      });
      if (!opened) return { place, payment: settled };

      await notify(tx, opened);
      await record(tx, { place: opened, reopened: false });
      return { place: opened, payment: settled };
    });
  }

  /**
   * Leave a place, and say so only if it was still held.
   *
   * `isActive: true` is part of the update's own `where` rather than a thing checked after it, which
   * is what makes `null` mean "nothing moved" instead of "something moved and I could not tell". The
   * caller already has the row from its own read, so `null` is a second press of the leave button and
   * answers with the closed row; the notifier and the recorder are reached by the road that closed a
   * place, so a double press files one letter and one record rather than two.
   *
   * Nothing is deleted. The row is the record of an access that happened, and the pages read under it
   * were opened by it.
   */
  async closePlace(
    studentUserId: string,
    id: string,
    notify?: PlaceNotifier,
    record?: WriteRecorder<PlaceNewsRow>,
  ): Promise<PlaceNewsRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const [closed] = await tx.enrollment.updateManyAndReturn({
        where: { id, studentUserId, isActive: true },
        data: { isActive: false },
        select: PLACE_NEWS_SELECT,
      });
      if (!closed) return null;

      await notify?.(tx, closed);
      await record?.(tx, closed);
      return closed;
    });
  }

  /** The caller's place by its own id, and only their own. */
  async findOwnPlace(studentUserId: string, id: string) {
    return this.prisma.enrollment.findFirst({
      where: { id, studentUserId },
      include: WITH_COURSE,
    });
  }

  /**
   * What the student is inside of, newest first.
   *
   * Only places that are open, and only in a course that still opens for them: one on the shelf, or
   * one its teacher paused as a draft. This is the catalog's outer gate read from the other side —
   * there it decides whether a course answers, here whether it appears on a list of links — so a
   * paused term stays in the reading record of the people who are partway through it.
   *
   * An archived course is left off, and the two statuses are named rather than written as "not
   * archived" for that reason: the archive closes the pages on its students too, and a list the
   * portal renders as links has to be a list of things that will open. The enrollment row of a
   * retired course is untouched by this filter — it stays for the record the pages the student
   * already read were opened by.
   */
  async listOpen(
    studentUserId: string,
    publishedCourseStatusValueId: string,
    draftCourseStatusValueId: string,
  ) {
    return this.prisma.enrollment.findMany({
      where: {
        studentUserId,
        isActive: true,
        course: {
          isActive: true,
          OR: [
            { statusValueId: publishedCourseStatusValueId },
            { statusValueId: draftCourseStatusValueId },
          ],
        },
      },
      include: WITH_COURSE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A course a place can be taken in: published and live, by id and nothing else, together with what
   * it costs.
   *
   * A slug is a nicer thing to read in a link than to write in a body, and the catalog already
   * answers both spellings; this route is given the id the catalog sent.
   *
   * The price comes back on the same read because every press needs it: a place is held or opened by
   * what the course says it is worth, and a service that read the gate and the price in two
   * statements would be answering "can this be joined" and "for how much" from two different moments
   * of the teacher's editing. Both halves are nullable — a course with no price is a free course, and
   * the service decides what that means.
   */
  async findEnrollableCourse(courseId: string, courseStatusValueId: string) {
    return this.prisma.course.findFirst({
      where: { id: courseId, isActive: true, statusValueId: courseStatusValueId },
      select: {
        id: true,
        priceMinorUnits: true,
        priceCurrency: { select: { id: true, code: true } },
      },
    });
  }

  /** The course whose roster is being read, and only if the caller wrote it. `isActive` is the
   * whole of the filter, not its status: a teacher who archived a course still owns the class
   * that sat in it, and §2 keeps the rows that say so. */
  async findOwnedCourse(teacherUserId: string, courseId: string) {
    return this.prisma.course.findFirst({
      where: { id: courseId, teacherUserId, isActive: true },
      select: { id: true },
    });
  }

  /**
   * Who holds an open place in one course, newest first, one page of them.
   *
   * `isActive` on the row, not on the student: a closed place is a person who left, and the
   * count below answers the same question the list does so a page of a roster can say how big
   * the class is.
   */
  async listRoster(courseId: string, skip: number, take: number) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({
        where: { courseId, isActive: true },
        include: WITH_STUDENT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.enrollment.count({ where: { courseId, isActive: true } }),
    ]);
    return { rows, total };
  }

  /**
   * Every name holding a place in one course, unpaged.
   *
   * The roster screen above is a page because a person reads it; this one is for the sweep that
   * writes a register beside a class, and a class does not get a partial attendance sheet. It lives
   * here rather than in the caller's own query because "who is enrolled" has exactly one answer in
   * this platform, and the row that owns the place is where it is defined.
   */
  async listActiveStudentIds(courseId: string): Promise<string[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: { courseId, isActive: true },
      select: { studentUserId: true },
    });
    return rows.map((row) => row.studentUserId);
  }
}
