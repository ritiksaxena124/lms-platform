import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * MS_PER_MINUTE;

/** The minute a teacher is being locked out of, as one string. Anything that names the same
 * instant and the same person has to collide on the same lock, and nothing else may. */
const lockKey = (args: { teacherUserId: string; startsAt: Date }) =>
  `${args.teacherUserId}@${args.startsAt.toISOString()}`;

/** The course a slot is offered for, and the two facts about it that decide who may look. */
const BOOKABLE_COURSE_SELECT = {
  id: true,
  slug: true,
  title: true,
  teacherUserId: true,
  demoBookingsEnabled: true,
  teacher: { select: { id: true, timezone: true } },
} as const satisfies Prisma.CourseSelect;

export type BookableCourseRow = Prisma.CourseGetPayload<{ select: typeof BOOKABLE_COURSE_SELECT }>;

/** A booking with the two vocabulary codes read out of the lookup rows behind it, which is the
 * shape every response from this module wears: the table stores ids and the client reads codes. */
const BOOKING_SELECT = {
  id: true,
  courseId: true,
  type: { select: { code: true } },
  status: { select: { code: true } },
  startsAt: true,
  durationMinutes: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.BookingSelect;

export type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>;

/**
 * What the write decided, in the two ways a request can end without a new row.
 *
 * `requested` covers both a fresh hold and a replay of the student's own identical request — the
 * student pressed a button and there is a class with their name on that minute, which is the same
 * answer to give either way. `held` is the minute belonging to somebody else's class, or to this
 * student's other course, and the caller turns it into a conflict on the field they typed.
 */
export type SlotRequestResult = { outcome: 'requested'; booking: BookingRow } | { outcome: 'held' };

/**
 * The table behind a booked class, and the course a booking is made against.
 *
 * Two things are read here that the table itself refuses to decide, and both are named as
 * questions rather than hidden in a query: which statuses occupy a minute (the unique index on
 * the slot hold keeps *a* row per minute and knows nothing about vocabulary — `BLOCKING_BOOKING_*`
 * statuses are the policy, resolved to lookup ids by the service), and whether a student has
 * already taken their one demo (a count over surviving rows, including the cancelled ones,
 * because the cap is about a person having tried a teacher once).
 *
 * Ownership is in every `where` clause rather than checked afterwards, the rule every repository
 * here runs on.
 */
@Injectable()
export class BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A course a student may book in: published and live, addressed by id or by slug.
   *
   * Both spellings reach one row, which is the property the catalog already keeps its routes to —
   * a student arrives at a booking screen from a link, and a link may carry either.
   */
  async findBookableCourse(
    ref: { id: string } | { slug: string },
    courseStatusValueId: string,
  ): Promise<BookableCourseRow | null> {
    return this.prisma.course.findFirst({
      where: { ...ref, isActive: true, statusValueId: courseStatusValueId },
      select: BOOKABLE_COURSE_SELECT,
    });
  }

  /** The minutes this teacher cannot offer, because a standing booking holds them. */
  async heldStarts(
    teacherUserId: string,
    blockingStatusValueIds: string[],
    from: Date,
    to: Date,
  ): Promise<Date[]> {
    if (blockingStatusValueIds.length === 0) return [];
    const rows = await this.prisma.booking.findMany({
      where: {
        teacherUserId,
        isActive: true,
        statusValueId: { in: blockingStatusValueIds },
        startsAt: { gte: from, lt: to },
      },
      select: { startsAt: true },
    });
    return rows.map((row) => row.startsAt);
  }

  /** Whether this student has ever taken a demo in this course — any demo, in any state. */
  async hasDemoBooking(
    courseId: string,
    studentUserId: string,
    demoTypeValueId: string,
  ): Promise<boolean> {
    const count = await this.prisma.booking.count({
      where: { courseId, studentUserId, typeValueId: demoTypeValueId, isActive: true },
    });
    return count > 0;
  }

  /**
   * Ask for a minute, and hold it if nobody else has.
   *
   * The advisory lock is what makes the read-then-write honest: two students pressing the same
   * square at the same moment run one after the other for that teacher-and-minute, rather than
   * both seeing a free slot and one of them finding out via a unique-index violation. The lock is
   * transaction-scoped, so it goes away by itself when the transaction does.
   *
   * The unique slot hold stays anyway. It is the last word rather than the first: a lock has to be
   * asked for, and a rule that only holds when every writer remembers to take it is a convention
   * waiting for the writer that did not.
   *
   * Two things are looked for before the insert, in this order and for different reasons. The
   * student's own standing request for this course at this minute comes back as their own row, so
   * a double press is one event rather than a fight with their earlier click. Then any standing
   * class of this teacher that overlaps the asked-for stretch — including this student's *other*
   * course, because a person cannot be in two classes at once and the pool of minutes is the
   * teacher's week rather than the course's.
   */
  async request(args: {
    studentUserId: string;
    teacherUserId: string;
    courseId: string;
    startsAt: Date;
    durationMinutes: number;
    typeValueId: string;
    pendingStatusValueId: string;
    blockingStatusValueIds: string[];
  }): Promise<SlotRequestResult> {
    const endsAt = new Date(args.startsAt.getTime() + args.durationMinutes * MS_PER_MINUTE);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(args)}))`;

      const own = await tx.booking.findFirst({
        where: {
          studentUserId: args.studentUserId,
          courseId: args.courseId,
          startsAt: args.startsAt,
          isActive: true,
          statusValueId: { in: args.blockingStatusValueIds },
        },
        select: BOOKING_SELECT,
      });
      if (own) return { outcome: 'requested', booking: own };

      if (await this.overlapWithin(tx, args, endsAt)) return { outcome: 'held' };

      try {
        const created = await tx.booking.create({
          data: {
            studentUserId: args.studentUserId,
            teacherUserId: args.teacherUserId,
            courseId: args.courseId,
            typeValueId: args.typeValueId,
            statusValueId: args.pendingStatusValueId,
            startsAt: args.startsAt,
            durationMinutes: args.durationMinutes,
            slotHeldAt: args.startsAt,
          },
          select: BOOKING_SELECT,
        });
        return { outcome: 'requested', booking: created };
      } catch (error) {
        // Somebody took the minute in the gap this transaction could not cover — an older row
        // written without the lock, or a hold released and retaken outside this instant. Re-read
        // rather than guess: if the row is this student's own, the second press replays.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        return (await this.standingFor(tx, args)) ?? { outcome: 'held' as const };
      }
    });
  }

  /** Any standing class of this teacher that runs into the asked-for stretch.
   *
   * Searched a day to the left of the request because a class that starts before it can still be
   * running when it does, and a day is wider than any window a teacher can record (the rules
   * column tops out under twenty-four hours) without this becoming a calendar scan.
   */
  private async overlapWithin(
    tx: Prisma.TransactionClient,
    args: { teacherUserId: string; startsAt: Date; blockingStatusValueIds: string[] },
    endsAt: Date,
  ): Promise<boolean> {
    if (args.blockingStatusValueIds.length === 0) return false;
    const candidates = await tx.booking.findMany({
      where: {
        teacherUserId: args.teacherUserId,
        isActive: true,
        statusValueId: { in: args.blockingStatusValueIds },
        startsAt: { gte: new Date(args.startsAt.getTime() - MS_PER_DAY), lt: endsAt },
      },
      select: { startsAt: true, durationMinutes: true },
    });
    return candidates.some(
      (row) =>
        row.startsAt.getTime() < endsAt.getTime() &&
        row.startsAt.getTime() + row.durationMinutes * MS_PER_MINUTE > args.startsAt.getTime(),
    );
  }

  /** The student's standing request for this course and minute, if the failed insert was theirs. */
  private async standingFor(
    tx: Prisma.TransactionClient,
    args: {
      studentUserId: string;
      courseId: string;
      startsAt: Date;
      blockingStatusValueIds: string[];
    },
  ): Promise<SlotRequestResult> {
    const row = await tx.booking.findFirst({
      where: {
        studentUserId: args.studentUserId,
        courseId: args.courseId,
        startsAt: args.startsAt,
        isActive: true,
        statusValueId: { in: args.blockingStatusValueIds },
      },
      select: BOOKING_SELECT,
    });
    return row ? { outcome: 'requested', booking: row } : { outcome: 'held' };
  }
}
