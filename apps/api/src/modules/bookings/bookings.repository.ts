import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { stretchesOverlap, type ClassStretch } from '@lms/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';

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
  /** Carried so a read can say whether this class has a room at all. The name itself never goes
   * on the wire — `toBooking` answers with the door's two instants and nothing else (§6). */
  roomName: true,
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

/** A written row with *both* parties on it, which is what the three status writes and the one
 * insert answer to: a class is news for a person, and the person has to be read in the same
 * statement that decided the news.
 *
 * The zones are the reason this is a select of its own rather than a widening of `BOOKING_SELECT`.
 * A read needs one name for a screen; a write needs two names and two clocks, because the instant a
 * class starts is a different minute in each of them and the letter is written in the reader's.
 * Nothing here goes on the wire — `toBooking` has never heard of any of it. */
const BOOKING_WRITE_SELECT = {
  ...BOOKING_SELECT,
  student: { select: { id: true, fullName: true, timezone: true } },
  teacher: { select: { id: true, fullName: true, timezone: true } },
} as const satisfies Prisma.BookingSelect;

export type BookingNewsRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_WRITE_SELECT }>;

/** The seam a write hands its news through, and the reason it is a parameter rather than a
 * dependency of this class: which event a row *is* is a decision about vocabulary and belongs to the
 * service, while *when* it is filed belongs here, next to the statement that moved the row.
 *
 * It is called with the transaction still open, so the news and the write commit together or not at
 * all; and it is called only on the road where the row changed, never on a replay — a second press
 * of the same button is the same request, and a teacher told twice about it stops believing the
 * queue. */
export type BookingNotifier = (
  tx: Prisma.TransactionClient,
  row: BookingNewsRow,
) => Promise<unknown>;

/** A class that just moved status, and the state it moved from.
 *
 * The after-image carries everything the letter about a change needs, and one thing the record of it
 * cannot be built without: what the class was before this write. A student's cancel is two different
 * decisions wearing one action code — taking back an ask, or walking out of a class the teacher had
 * said yes to — and the state that distinguishes them is gone from the table the moment the swap
 * lands. So the row the swap's own `where` clause was built from travels to the recorder as well,
 * which costs no read because it is the read the race clause already needed. */
export type BookingTransition = { booking: BookingNewsRow; from: string };

/** The four facts the join gate needs, and the one column no list of this table ever carries.
 *
 * `BOOKING_SELECT` says whether a class has a room; this says what its address is built from, for
 * the two accounts the class is about. A separate read rather than a wider booking select, because
 * the row it returns leaves the process only as a URL. */
const BOOKING_ROOM_SELECT = {
  id: true,
  startsAt: true,
  durationMinutes: true,
  roomName: true,
  status: { select: { code: true } },
} as const satisfies Prisma.BookingSelect;

export type BookingRoomRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_ROOM_SELECT }>;

/** The three facts the mark door reads before it writes anything, and the shape it reads them in.
 *
 * A mark is refused three different ways and the refusals say different things, so the route has to
 * know which one it is answering: a class that has not begun yet, a class that is not a standing
 * confirmed one, and a class that was marked the other word already. `swapOwnedStatus` cannot tell
 * them apart — it comes back `not-standing` for all three, because all three are the same thing to
 * an `update` that matched nothing. So the state is read once, cheaply, to choose the sentence.
 *
 * The start travels because the mark is judged against it. Nothing else about the class is read: a
 * refusal about a state needs no title, no name and no room. */
const BOOKING_MARK_TARGET_SELECT = {
  id: true,
  startsAt: true,
  status: { select: { code: true } },
} as const satisfies Prisma.BookingSelect;

export type BookingMarkTargetRow = Prisma.BookingGetPayload<{
  select: typeof BOOKING_MARK_TARGET_SELECT;
}>;

/**
 * What the write decided, in the two ways a request can end without a new row.
 *
 * `requested` covers both a fresh hold and a replay of the student's own identical request — the
 * student pressed a button and there is a class with their name on that minute, which is the same
 * answer to give either way. `held` is the minute belonging to somebody else's class, or to this
 * student's other course, and the caller turns it into a conflict on the field they typed.
 *
 * Which of the two `requested` roads a caller arrived on is deliberately invisible here, and it is
 * also the one thing a notification cannot be blind to — so the split is settled where it is made,
 * at the insert, and neither the notifier nor the recorder is reached by a replay.
 */
export type SlotRequestResult = { outcome: 'requested'; booking: BookingRow } | { outcome: 'held' };

/**
 * What a status-changing write to one owned row came down to — the student leaving a class and
 * the teacher answering one both report through this.
 *
 * `done` is written for two roads that arrive at the same place: the row this write just changed,
 * and the row that already said what the caller wanted it to say. Both answer with the class as it
 * now reads, which is the whole difference between a retry and an error. Only the first of them
 * files news, or a record — the second is the same answer given twice, and a person told twice about
 * one confirmation starts wondering which of the two was real.
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
 *
 * The writes that change a class — the insert, the status swap, the expiry sweep — take a `notify`
 * and call it inside their own transaction. That is the outbox rule (ARCHITECTURE §6) in one
 * sentence: the news is filed by the write that made it, so a class that rolled back cannot have a
 * letter about it waiting to send. One caller passes no `notify` at all — the mark files a record and
 * mails nobody — which is why the callback is a parameter on the write rather than a mail service
 * wired into this class.
 *
 * Each takes a `record` too, called on the same road a line later for the reason Phase 7 gives for
 * the same choice everywhere: the log is the account of what the platform did, and an account of a
 * change that never committed is worse than no account at all. Two callbacks rather than one folded
 * together because they file into two tables that answer two different questions — who hears about
 * this class, and who can read later that it happened — and it is the service that owns both answers,
 * while this class owns only the moment.
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

  /** The standing classes of this teacher that a grid must not offer, as starts plus lengths.
   *
   * A stretch rather than a start, because the read used to hide only the exact minute another
   * booking began and went on offering the squares that class was still running through — which
   * the write then refused, on the click. The search opens a day before the horizon for the reason
   * `overlapWithin` gives: a class that started earlier can be unfinished when the first square of
   * the horizon appears.
   */
  async heldStretches(
    teacherUserId: string,
    blockingStatusValueIds: string[],
    from: Date,
    to: Date,
  ): Promise<ClassStretch[]> {
    if (blockingStatusValueIds.length === 0) return [];
    const rows = await this.prisma.booking.findMany({
      where: {
        teacherUserId,
        isActive: true,
        statusValueId: { in: blockingStatusValueIds },
        startsAt: { gte: new Date(from.getTime() - MS_PER_DAY), lt: to },
      },
      select: { startsAt: true, durationMinutes: true },
    });
    return rows.map((row) => ({
      startsAt: row.startsAt,
      durationMinutes: row.durationMinutes,
    }));
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
    notify?: BookingNotifier;
    record?: WriteRecorder<BookingNewsRow>;
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
      // Their own standing request, so nothing happened that the first press did not already report.
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
          select: BOOKING_WRITE_SELECT,
        });
        await args.notify?.(tx, created);
        await args.record?.(tx, created);
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
    const asked: ClassStretch = {
      startsAt: args.startsAt,
      durationMinutes: (endsAt.getTime() - args.startsAt.getTime()) / MS_PER_MINUTE,
    };
    // The same predicate the offered grid is cut with, so the two cannot disagree about which
    // minute is somebody else's class.
    return candidates.some((row) => stretchesOverlap(row, asked));
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

  /**
   * The room on a class this account is one of the two parties to.
   *
   * Ownership is the `where` clause rather than a check afterwards, and it is deliberately
   * symmetrical: the student who booked the class and the teacher whose calendar carries it are
   * both asked for and both answered, because a live class has two people who may walk in and a
   * role claim is not one of them. Every other account — a stranger, another student holding a
   * place in the same course, a teacher of a different course — gets `null`, which is the same
   * answer the service gives for a class that was never written.
   */
  async findRoomFor(bookingId: string, userId: string): Promise<BookingRoomRow | null> {
    return this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        isActive: true,
        OR: [{ studentUserId: userId }, { teacherUserId: userId }],
      },
      select: BOOKING_ROOM_SELECT,
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
   * End every request that has run out, hand back the minutes it was holding, and tell the students
   * whose requests they were. Returns how many rows the sweep changed.
   *
   * Two clocks, because they ask different questions. `olderThan` is a teacher's silence read as
   * the answer it is, whatever the class time; `at` is a class minute that arrived without a yes,
   * however recently the student asked. Either one on its own is enough to end the request, and a
   * week of nightly classes swept on age alone would hold seven minutes nobody is standing in.
   *
   * Row by row rather than in one `updateMany`, and the notifier is why: a bulk update comes back
   * with a count, and a count cannot be addressed. A letter has to go to the student who asked for
   * *that* minute, so the sweep has to learn which rows it moved, not merely how many — and it can
   * only learn that by asking for each row's own after-image inside the transaction that files the
   * news about it. The record of the expiry is filed in the same transaction for the same reason: a
   * row that matched nothing belongs to no decision, and no sweep may claim it ended one.
   *
   * What makes it safe to run twice, and in two places at once, is unchanged: the pending status is
   * in every row's own `where`, so an expired row matches nothing on a second pass, and a minute a
   * newer request has just been given the hold to cannot be taken back by an older sweep arriving
   * late.
   */
  async expirePending(args: {
    pendingStatusValueId: string;
    expiredStatusValueId: string;
    olderThan: Date;
    at: Date;
    notify?: BookingNotifier;
    record?: WriteRecorder<BookingNewsRow>;
  }): Promise<number> {
    const standing = await this.prisma.booking.findMany({
      where: {
        isActive: true,
        statusValueId: args.pendingStatusValueId,
        OR: [{ createdAt: { lte: args.olderThan } }, { startsAt: { lte: args.at } }],
      },
      select: { id: true },
    });

    let expired = 0;
    for (const { id } of standing) {
      const moved = await this.prisma.$transaction(async (tx) => {
        const [after] = await tx.booking.updateManyAndReturn({
          where: { id, isActive: true, statusValueId: args.pendingStatusValueId },
          data: { statusValueId: args.expiredStatusValueId, slotHeldAt: null },
          select: BOOKING_WRITE_SELECT,
        });
        if (!after) return false;
        await args.notify?.(tx, after);
        await args.record?.(tx, after);
        return true;
      });
      if (moved) expired += 1;
    }
    return expired;
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
    notify?: BookingNotifier;
    record?: WriteRecorder<BookingTransition>;
  }): Promise<AnswerOutcome> {
    return this.swapOwnedStatus({
      bookingId: args.bookingId,
      owner: { studentUserId: args.studentUserId },
      fromStatusValueIds: args.cancellableStatusValueIds,
      toStatusValueId: args.cancelledStatusValueId,
      releaseHold: true,
      notify: args.notify,
      record: args.record,
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
    /** The room the class the teacher just agreed to happens in, from the video port. Written in
     * the same statement as the status, because a confirmed class whose room arrived in a second
     * write is a class with a missing half whenever that second write fails. */
    mintRoomName?: string;
    notify?: BookingNotifier;
    record?: WriteRecorder<BookingTransition>;
  }): Promise<AnswerOutcome> {
    return this.swapOwnedStatus({
      bookingId: args.bookingId,
      owner: { teacherUserId: args.teacherUserId },
      fromStatusValueIds: [args.pendingStatusValueId],
      toStatusValueId: args.answerStatusValueId,
      releaseHold: args.releaseHold,
      mintRoomName: args.mintRoomName,
      notify: args.notify,
      record: args.record,
    });
  }

  /**
   * The row a mark is being asked about, for the one thing the swap cannot answer: which refusal to
   * say.
   *
   * Ownership is in the `where` rather than checked afterwards, like every other write here, so
   * another teacher's class answers with the same silence as a class that never existed.
   */
  async markTarget(bookingId: string, teacherUserId: string): Promise<BookingMarkTargetRow | null> {
    return this.prisma.booking.findFirst({
      where: { id: bookingId, teacherUserId, isActive: true },
      select: BOOKING_MARK_TARGET_SELECT,
    });
  }

  /**
   * Mark off one of this teacher's classes: it happened, or the student never came.
   *
   * The row must still be `confirmed` for either word to land, which is the rule that keeps a mark
   * from being written over a request nobody answered, a refusal, an expiry or a cancellation — each
   * of those already says what became of the class, and reporting a class that never stood as one
   * that was missed would be a record, not a correction.
   *
   * The minute goes back either way. Both words end the class, and a class that is over has no claim
   * on a calendar minute — which is what `BLOCKING_BOOKING_STATUSES` has said all along. The row
   * itself survives, because a class that was held and then taught or missed is a fact the teacher's
   * history and the student's list both still read.
   *
   * No `notify`: the four booking letters each ask something of the person who reads them, and a mark
   * reports a class that is already over. The record is the whole report, and the student sees the
   * ending on their own list.
   */
  async markOwned(args: {
    bookingId: string;
    teacherUserId: string;
    confirmedStatusValueId: string;
    markStatusValueId: string;
    record?: WriteRecorder<BookingTransition>;
  }): Promise<AnswerOutcome> {
    return this.swapOwnedStatus({
      bookingId: args.bookingId,
      owner: { teacherUserId: args.teacherUserId },
      fromStatusValueIds: [args.confirmedStatusValueId],
      toStatusValueId: args.markStatusValueId,
      releaseHold: true,
      record: args.record,
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
   *
   * The read and the swap run in one transaction, which is not needed for the swap's honesty and is
   * entirely needed for the notifier's and the recorder's: what a change is said to have done has to
   * be filed while the change is still uncommitted, so a write that rolls back cannot leave a letter
   * about it — or a record of it — behind.
   *
   * The record is handed the state the row was read in as well as the row after the swap, because
   * that is the one fact about the change the table stops holding once the change lands, and it is
   * the read the race clause already had to make.
   */
  private async swapOwnedStatus(args: {
    bookingId: string;
    owner: { studentUserId?: string; teacherUserId?: string };
    fromStatusValueIds: string[];
    toStatusValueId: string;
    releaseHold: boolean;
    mintRoomName?: string;
    notify?: BookingNotifier;
    record?: WriteRecorder<BookingTransition>;
  }): Promise<AnswerOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.booking.findFirst({
        where: { id: args.bookingId, ...args.owner, isActive: true },
        select: BOOKING_WRITE_SELECT,
      });
      if (!row) return { outcome: 'missing' };
      if (row.statusValueId === args.toStatusValueId) return { outcome: 'done', booking: row };
      if (!args.fromStatusValueIds.includes(row.statusValueId)) return { outcome: 'not-standing' };

      const [after] = await tx.booking.updateManyAndReturn({
        where: {
          id: args.bookingId,
          ...args.owner,
          isActive: true,
          statusValueId: row.statusValueId,
        },
        data: {
          statusValueId: args.toStatusValueId,
          ...(args.releaseHold ? { slotHeldAt: null } : {}),
          ...(args.mintRoomName ? { roomName: args.mintRoomName } : {}),
        },
        select: BOOKING_WRITE_SELECT,
      });

      // `changed` is the loser of the race, and a message about a class this write did not change is
      // exactly the lie the outcome exists to prevent. So both callbacks are reached by one road only.
      if (!after) return { outcome: 'changed' };
      await args.notify?.(tx, after);
      await args.record?.(tx, { booking: after, from: row.status.code });
      return { outcome: 'done', booking: after };
    });
  }
}
