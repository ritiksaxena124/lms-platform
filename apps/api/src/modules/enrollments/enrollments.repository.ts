import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';

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

/**
 * The table behind the student's place in a course.
 *
 * Every read and write is scoped by `studentUserId` in the `where` clause rather than checked
 * afterwards — the same rule the teacher's repositories run on, arriving on the other side of
 * the relationship. A place in somebody else's name and a place that was never taken answer
 * the same way, so no call can probe which enrollments exist.
 *
 * The two writes each take a `notify` and call it inside their own transaction, which is the outbox
 * rule (ARCHITECTURE §6) in one sentence: the news is filed by the write that made it, so a place
 * whose row rolled back cannot have a letter about it waiting to send. Each takes a `record` for the
 * same moment and the same reason: Phase 7's log is the account of what the platform did, and an
 * account of a change that never committed is worse than no account at all.
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

  /**
   * Take a place, and say so once.
   *
   * Three roads, and only two of them are news. The student already holds it — the press is a
   * replay, and the row that answers is the one with the original `createdAt` on it. The row is
   * there and closed — reopened rather than replaced, because the pair is unique and the day the
   * place was *first* taken is a fact the student did not move by going away and coming back.
   * Neither row is there — the place is opened.
   *
   * The read and the write are one transaction so that the news filed at the end describes the row
   * as it was written, and so a callback that throws takes the row back with it.
   */
  async takePlace(
    studentUserId: string,
    courseId: string,
    notify?: PlaceNotifier,
    record?: WriteRecorder<PlaceRecord>,
    couponId?: string | null,
    paymentAmount?: number | null,
    currencyValueId?: string | null,
    paymentStatusValueId?: string | null,
  ): Promise<PlaceNewsRow> {
    return this.prisma.$transaction(async (tx) => {
      const standing = await tx.enrollment.findUnique({
        where: { courseId_studentUserId: { courseId, studentUserId } },
        select: PLACE_NEWS_SELECT,
      });
      if (standing?.isActive) return standing;

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

      // If a coupon was used, create a payment record and increment redemption count
      if (couponId && paymentAmount != null && currencyValueId && paymentStatusValueId) {
        await tx.payment.create({
          data: {
            enrollmentId: place.id,
            couponId,
            amountMinorUnits: paymentAmount,
            currencyValueId,
            statusValueId: paymentStatusValueId,
            providerReference: 'mock-payment', // Mock provider for POC
          },
        });

        // Increment coupon redemption count
        await tx.coupon.update({
          where: { id: couponId },
          data: { redemptionCount: { increment: 1 } },
        });
      }

      await notify?.(tx, place);
      await record?.(tx, { place, reopened: standing !== null });
      return place;
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

  /** A course a place can be taken in: published and live, by id and nothing else. A slug
   * is a nicer thing to read in a link than to write in a body, and the catalog already
   * answers both spellings; this route is given the id the catalog sent. */
  async findEnrollableCourse(courseId: string, courseStatusValueId: string) {
    return this.prisma.course.findFirst({
      where: { id: courseId, isActive: true, statusValueId: courseStatusValueId },
      select: { id: true },
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

  /** Get the price of a course for coupon validation. Returns null if the course doesn't exist. */
  async getCoursePrice(courseId: string) {
    return this.prisma.course.findUnique({
      where: { id: courseId },
      select: { priceMinorUnits: true },
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
