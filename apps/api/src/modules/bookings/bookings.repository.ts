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
 * shape every response from this module wears: the table stores ids and the client reads codes.
 *
 * `statusValueId` travels along for the same reason the hold column does — the cancel path needs
 * to know which row it is standing down in order to say so in one write rather than two — and it
 * is never copied into a response, because a client reads the code. */
const BOOKING_SELECT = {
  id: true,
  statusValueId: true,
  course: { select: { id: true, slug: true, title: true } },
  type: { select: { code: true } },
  status: { select: { code: true } },
  startsAt: true,
  durationMinutes: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.BookingSelect;

export type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>;

/** The same row with the student on it, which is the only thing a teacher's list needs that a
 * student's own does not: a teacher answers about a person, not about an id. */
const BOOKING_REQUEST_SELECT = {
  ...BOOKING_SELECT,
  student: { select: { id: true, fullName: true } },
} as const satisfies Prisma.BookingSelect;

export type BookingRequestRow = Prisma.BookingGetPayload<{
  select: typeof BOOKING_REQUEST_SELECT;
}>;

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
 * What a status-changing write to one owned row came down to — the student leaving a class and
 * the teacher answering one both report through this.
 *
 * `done` is written for two roads that arrive at the same place: the row this write just changed,
 * and the row that already said what the caller wanted it to say. Both answer with the class as it
 * now reads, which is the whole difference between a retry and an error.
 *
 * `not-standing` is a class whose state has moved past the one the caller could act on — taught,
 * missed, refused, left to expire, or answered the other way already; `changed` is the rarer
 * corner where the status read a moment ago was rewritten by somebody else before this write
 * landed, so no row matched and the caller must not claim a change it did not make.
 */
export type AnswerOutcome =
  | { outcome: 'done'; booking: BookingRow }
  | { outcome: 'not-standing' }
  | { outcome: 'changed' }
  | { outcome: 'missing' };

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
        return this.standingFor(tx, args);
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

  /** The requests on this teacher's calendar that are still waiting for an answer, soonest first.
   *
   * Pending only, because the name of the route is the filter: everything else the teacher has
   * already said something about lives on their class list instead, which is a different question
   * asked of the same table.
   */
  async listRequests(
    teacherUserId: string,
    pendingStatusValueId: string,
  ): Promise<BookingRequestRow[]> {
    return this.prisma.booking.findMany({
      where: { teacherUserId, isActive: true, statusValueId: pendingStatusValueId },
      orderBy: { startsAt: 'asc' },
      select: BOOKING_REQUEST_SELECT,
    });
  }

  /** Every class on this teacher's calendar, soonest first, whatever became of the request.
   *
   * The teacher half of `listOwned`, and the reason it is a separate read rather than a filter on
   * that one: a booking row carries both ends of the class, so a query on `studentUserId` cannot
   * answer "what am I teaching" without first being told who is asking, which is a rule about a
   * session living in a place that has no session.
   *
   * It carries the name for the same reason the requests list does — a teacher's six o'clock is
   * somebody's lesson — and it is the row's own state that decides whether that person is still
   * standing in it, which is why nothing is filtered out here.
   */
  async listClasses(teacherUserId: string): Promise<BookingRequestRow[]> {
    return this.prisma.booking.findMany({
      where: { teacherUserId, isActive: true },
      orderBy: { startsAt: 'asc' },
      select: BOOKING_REQUEST_SELECT,
    });
  }

  /** Every class this student has ever asked for, soonest first.
   *
   * All of them, including the called-off and the taught: this is the record a student's own
   * calendar screen reads, and a screen that wants next week filters on the start it is given.
   * Deciding what counts as "upcoming" here would be one rule for that screen and another for
   * whatever is built next.
   */
  async listOwned(studentUserId: string): Promise<BookingRow[]> {
    return this.prisma.booking.findMany({
      where: { studentUserId, isActive: true },
      orderBy: { startsAt: 'asc' },
      select: BOOKING_SELECT,
    });
  }

  /**
   * End every request that has run out, and hand back the minutes it was holding. Returns how
   * many rows the sweep changed.
   *
   * Two clocks, because they ask different questions. `olderThan` is a teacher's silence read as
   * the answer it is, whatever the class time; `at` is a class minute that arrived without a yes,
   * however recently the student asked. Either one on its own is enough to end the request, and a
   * week of nightly classes swept on age alone would hold seven minutes nobody is standing in.
   *
   * One `updateMany` rather than a read-and-swap per row, because there is no caller here to give
   * an outcome to: whoever wanted the decision has already gone. The pending status in the `where`
   * is what makes the sweep safe to run twice and safe to run in two places at once — an expired
   * row is no longer pending, so a second pass finds nothing, and a row that some newer request
   * has just been given the hold to cannot be taken back by an older sweep arriving late.
   */
  async expirePending(args: {
    pendingStatusValueId: string;
    expiredStatusValueId: string;
    olderThan: Date;
    at: Date;
  }): Promise<number> {
    const { count } = await this.prisma.booking.updateMany({
      where: {
        isActive: true,
        statusValueId: args.pendingStatusValueId,
        OR: [{ createdAt: { lte: args.olderThan } }, { startsAt: { lte: args.at } }],
      },
      data: { statusValueId: args.expiredStatusValueId, slotHeldAt: null },
    });
    return count;
  }

  /**
   * Stand a student down from one of their classes, and hand the minute back.
   *
   * One write, because the two halves have to happen together: a row that says cancelled while
   * still holding `slotHeldAt` keeps a teacher's calendar free of a class nobody is coming to,
   * which is the exact thing a cancel is for. Nothing is deleted — the row keeps its identity and
   * its history, and the demo cap counts it a class later.
   *
   * The status the row was read at is part of the update's own `where`, which is what makes the
   * answer honest when a teacher confirmed or refused the class in the moment between the read and
   * the write: the swap matches no rows, and `changed` says the class is not the one the student
   * was looking at rather than claiming something that has not happened.
   */
  async cancelOwned(args: {
    bookingId: string;
    studentUserId: string;
    cancellableStatusValueIds: string[];
    cancelledStatusValueId: string;
  }): Promise<AnswerOutcome> {
    return this.swapOwnedStatus({
      bookingId: args.bookingId,
      owner: { studentUserId: args.studentUserId },
      fromStatusValueIds: args.cancellableStatusValueIds,
      toStatusValueId: args.cancelledStatusValueId,
      releaseHold: true,
    });
  }

  /**
   * Answer one of this teacher's requests: yes, and the minute stays held; no, and it goes back.
   *
   * The row must still be `pending` for either answer to land, which is what keeps a teacher from
   * taking back something they said last week and from overwriting a student's cancellation — the
   * two roads a careless `update` would happily pave over.
   */
  async answerOwned(args: {
    bookingId: string;
    teacherUserId: string;
    pendingStatusValueId: string;
    answerStatusValueId: string;
    releaseHold: boolean;
  }): Promise<AnswerOutcome> {
    return this.swapOwnedStatus({
      bookingId: args.bookingId,
      owner: { teacherUserId: args.teacherUserId },
      fromStatusValueIds: [args.pendingStatusValueId],
      toStatusValueId: args.answerStatusValueId,
      releaseHold: args.releaseHold,
    });
  }

  /**
   * The one write behind both status changes, so the two doors cannot disagree about how a status
   * moves: read the row this caller owns, refuse if it is not in a state the caller may act on,
   * then update it with the status just read as part of the `where`.
   *
   * That last clause is the race. A teacher confirming at the same moment the student cancels gets
   * one of the two answers, not a row whose status says one thing and whose hold says another — the
   * loser's swap matches no rows and comes back `changed`, which is a retry, not a lie.
   *
   * Releasing the hold and setting the status are one statement for the same reason: a row that
   * says cancelled while still holding a minute keeps a class off a calendar nobody is using.
   */
  private async swapOwnedStatus(args: {
    bookingId: string;
    owner: { studentUserId?: string; teacherUserId?: string };
    fromStatusValueIds: string[];
    toStatusValueId: string;
    releaseHold: boolean;
  }): Promise<AnswerOutcome> {
    const row = await this.prisma.booking.findFirst({
      where: { id: args.bookingId, ...args.owner, isActive: true },
      select: BOOKING_SELECT,
    });
    if (!row) return { outcome: 'missing' };
    if (row.statusValueId === args.toStatusValueId) return { outcome: 'done', booking: row };
    if (!args.fromStatusValueIds.includes(row.statusValueId)) return { outcome: 'not-standing' };

    const [after] = await this.prisma.booking.updateManyAndReturn({
      where: {
        id: args.bookingId,
        ...args.owner,
        isActive: true,
        statusValueId: row.statusValueId,
      },
      data: {
        statusValueId: args.toStatusValueId,
        ...(args.releaseHold ? { slotHeldAt: null } : {}),
      },
      select: BOOKING_SELECT,
    });

    return after ? { outcome: 'done', booking: after } : { outcome: 'changed' };
  }
}
