import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ACTION_CODES,
  API_ERROR_CODES,
  BLOCKING_BOOKING_STATUSES,
  BOOKING_HORIZON_DAYS,
  BOOKING_STATUS_CODES,
  BOOKING_TYPE_CODES,
  CANCELLABLE_BOOKING_STATUSES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  MAIL_EVENT_CODES,
  SLOT_DENIAL_CODES,
  SLOT_ENTITLEMENT_CODES,
  expandWindows,
  liveClassWindow,
  slotAt,
  stretchesOverlap,
  type Booking,
  type BookingRequest,
  type BookingRoom,
  type BookingStatusCode,
  type BookingTypeCode,
  type OpenSlot,
  type OpenSlotsResponse,
  type SlotDenialCode,
  type SlotEntitlementCode,
} from '@lms/shared';

import { ActionRecorder } from '../action-log/action-recorder';
import { AvailabilityRepository } from '../availability/availability.repository';
import { EnrollmentsRepository } from '../enrollments/enrollments.repository';
import { MailQueue } from '../notifications/mail-queue.service';
import { ReferenceService } from '../../reference/reference.service';
import { VIDEO, type Video } from '../../providers/video/video.port';
import type { BookableCourseRow, BookingRequestRow, BookingRow } from './bookings.repository';
import { BookingsRepository } from './bookings.repository';
import type { CreateBookingDto } from './dto/create-booking.dto';

/** A course is addressed by the id the API issued or the slug a link carries; a shape that
 * cannot be an id is read as a slug, which is the rule the catalog already runs on. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MS_PER_MINUTE = 60 * 1000;

/** A row out of the booking table, in the shape every portal reads it.
 *
 * The lookup ids become the codes the shared vocabulary uses, and the end is worked out from the
 * length the table froze rather than stored: a class that was booked as an hour is an hour, even
 * after the teacher's window around it changes, which is the whole reason the length lives on the
 * row instead of being re-derived from the rules at display time.
 *
 * `live` is the one field the table does not carry directly. It is the door's two instants, cut
 * from the class's own start and end, and it appears on exactly the rows that can be entered — a
 * confirmed class with a room. A pending request has neither yet, and a class the student walked
 * out of still remembers its room for the history while having no door to open. The name itself
 * stays here: what goes on the wire is the window, and the address is the join endpoint's to hand
 * out one person at a time (§6). */
function toBooking(row: BookingRow): Booking {
  const endsAt = new Date(row.startsAt.getTime() + row.durationMinutes * MS_PER_MINUTE);
  const status = row.status.code as BookingStatusCode;
  const enterable =
    row.roomName !== null && status === BOOKING_STATUS_CODES.CONFIRMED
      ? liveClassWindow(row.startsAt, endsAt)
      : null;

  return {
    id: row.id,
    course: { id: row.course.id, slug: row.course.slug, title: row.course.title },
    type: row.type.code as BookingTypeCode,
    status,
    live: enterable && {
      opensAt: enterable.opensAt.toISOString(),
      closesAt: enterable.closesAt.toISOString(),
    },
    startsAt: row.startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A request as the teacher reads it: the same class, and the person they are deciding about. */
function toRequest(row: BookingRequestRow): BookingRequest {
  return {
    ...toBooking(row),
    student: { id: row.student.id, displayName: row.student.fullName },
  };
}

/** Reported against `startsAt`, the box the student was choosing in, for the same reason the
 * availability service reports an overlap against `startMinutes`: a person reading "this minute is
 * taken" needs to know which minute the API means. */
function takenMinute(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'Check the highlighted fields.',
    details: {
      validation: {
        startsAt: ['That class time is no longer free. Pick another one from the calendar.'],
      },
    },
  });
}

/** The two reasons a student who is entitled to nothing were told so on the calendar already,
 * said again here because a write needs its own answer: `200` with an empty list is a screen, but
 * a request that cannot exist is a conflict with the state of the course. */
function notEntitled(denial: SlotDenialCode | null): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message:
      denial === SLOT_DENIAL_CODES.DEMO_ALREADY_TAKEN
        ? 'You have already used the one demo call this course offers. Enroll to book its classes.'
        : 'Enroll in this course to book its classes.',
  });
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.VALIDATION_FAILED,
    message: 'Check the highlighted fields.',
    details: { validation: { [field]: [message] } },
  });
}

/** One message for "not yours" and "never there", the way every other owned row here answers: a
 * student walking ids would otherwise learn which classes other students have. */
function notFoundBooking(): NotFoundException {
  return new NotFoundException({
    code: API_ERROR_CODES.NOT_FOUND,
    message: 'We cannot find that class.',
  });
}

function nothingToCancel(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This class is not standing, so there is nothing to cancel.',
  });
}

/** Said to a teacher who pressed an answer on a request that no longer waits for one — including
 * the case where the student has already left, which is the teacher's question having gone away. */
function alreadyAnswered(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This request has already been answered, so it cannot be answered again.',
  });
}

/** The read said one thing and the write found another, because somebody acted in between. Both
 * doors get this: the student who cancelled as the teacher confirmed and the teacher who confirmed
 * as the student cancelled are the same event seen from opposite ends. */
function changedElsewhere(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This class changed while you were deciding. Refresh to see it.',
  });
}

/** A class that does not stand has nobody to let in: the request still waiting for its answer, the
 * one refused, the one given up, the one that expired. One message for all of them, because the
 * list already says which it is and this route is not the place to relitigate the difference. */
function nothingToJoin(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This class is not standing, so there is no room to join.',
  });
}

/** Inside the five-minute leash before the first minute, which is the only reason the leash exists:
 * a student arriving at 08:58 for a 09:00 class is on time. The instant travels so a portal whose
 * clock disagrees still counts down to the minute the server will unlock. */
function doorNotYet(opensAt: Date): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: "This class's room is not open yet.",
    details: { opensAt: opensAt.toISOString() },
  });
}

/** Past the class and its grace. The room is still on the row — a class that was taught is not
 * un-taught — but nobody arriving now is arriving for it. */
function doorShut(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This class is over, and its room is closed.',
  });
}

/** `VIDEO_PROVIDER=none` is a deployment rather than a fault: the class stands and there is
 * nowhere to be. A conflict about the platform, not a 500, because nothing failed — and a
 * participant only reaches this route by asking, since the list gives them no door to draw. */
function noLiveRoom(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This platform does not run live classes.',
  });
}

/** Who this student is to this course, or the reason they are nobody to it.
 *
 * A place comes first and outranks everything: a student who enrolled is booking a class, not
 * sampling a teacher, whatever the trial setting says. After that the course has to have opened
 * itself to demo calls, and the student must never have taken one.
 */
interface Entitlement {
  code: SlotEntitlementCode;
  denial: SlotDenialCode | null;
}

/**
 * The calendar a student reads.
 *
 * The grid is never stored, so nothing here repairs a table when a teacher changes their week:
 * the windows are expanded across the coming horizon in the *teacher's* zone — the account's, not
 * the course's, because that is what decides when their classes are — and then cut down by the
 * two facts that make an offer undeliverable. A minute a standing booking is still running
 * through goes, and a minute already gone by never arrives. The first is cut with the same
 * arithmetic the booking write applies: a grid that hid only the exact minute another class
 * started on would offer a square it then refused, and the student would learn about the
 * collision by clicking it.
 *
 * The entitlement is decided before a single window is read, so a student with no right to the
 * calendar cannot cost the platform a week of expansion, and so the reason can be stated rather
 * than inferred from an empty list. An empty list is still a `200`: "enroll first" and "you
 * already used your trial call" are two different screens, not two error paths.
 *
 * A course nobody published answers the way the catalog answers — the same message an invented id
 * gets — because a booking calendar that distinguished them would be a way to walk a teacher's
 * unpublished work.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly rules: AvailabilityRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly reference: ReferenceService,
    private readonly mail: MailQueue,
    private readonly actions: ActionRecorder,
    @Inject(VIDEO) private readonly video: Video,
  ) {}

  async openSlots(studentUserId: string, address: string): Promise<OpenSlotsResponse> {
    const course = await this.resolveCourse(address);

    const from = new Date();
    const to = new Date(from.getTime() + BOOKING_HORIZON_DAYS * MS_PER_DAY);
    const access = await this.entitlementFor(course, studentUserId);
    const described = {
      course: {
        id: course.id,
        slug: course.slug,
        title: course.title,
        demoBookingsEnabled: course.demoBookingsEnabled,
      },
      teacher: { id: course.teacher.id, timezone: course.teacher.timezone },
      from: from.toISOString(),
      to: to.toISOString(),
    };

    if (access.code === SLOT_ENTITLEMENT_CODES.NONE) {
      return { ...described, entitlement: access.code, denial: access.denial, slots: [] };
    }

    const windows = await this.rules.listActive(course.teacherUserId);
    const held = await this.bookings.heldStretches(
      course.teacherUserId,
      await this.statusIds(BLOCKING_BOOKING_STATUSES),
      from,
      to,
    );
    const slots: OpenSlot[] = expandWindows(windows, course.teacher.timezone, { from, to })
      .filter(
        (slot) =>
          // The square goes if any standing class runs through it — the same question the write asks.
          !held.some((stretch) =>
            stretchesOverlap(stretch, {
              startsAt: slot.startsAt,
              durationMinutes: (slot.endsAt.getTime() - slot.startsAt.getTime()) / MS_PER_MINUTE,
            }),
          ),
      )
      .map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      }));

    return { ...described, entitlement: access.code, denial: access.denial, slots };
  }

  /**
   * Take a class: ask for one minute of a teacher's week, and hold it until they answer.
   *
   * The order is the price of each question, cheapest refusal first. A course the shelf does not
   * carry is a `NOT_FOUND` before anything else is looked at, because a booking cannot be about a
   * course that does not exist. Whether this student may book at all is answered next, from the
   * enrollment and the course's own trial setting — before a week of windows is expanded for
   * somebody who was never going to be offered one. Only then does the minute itself get judged,
   * and only then is a row written.
   *
   * The instant must be one this teacher's grid opens *and* one inside the horizon the calendar
   * searched. Both are needed and neither covers the other: the windows repeat weekly, so a minute
   * two months out is a genuine class start that nobody has been shown, and holding a class the
   * platform never offered is exactly what the horizon exists to stop.
   *
   * What the student sent is deliberately small. The kind of booking is the entitlement the read
   * already derived — a place makes it an enrolled class, otherwise the trial door makes it a demo
   * — and the length is the window's, taken from the tile the minute matched. A status is not
   * accepted at all: a request is pending until the teacher says otherwise, and a student who
   * could send `confirmed` would be confirming their own class.
   *
   * The insert is the only part that races, and it is the repository's problem to lock; a second
   * press by the same student for the same minute replays their own row rather than answering a
   * conflict, because the portal would otherwise have to remember whether it had been clicked.
   */
  async create(studentUserId: string, dto: CreateBookingDto): Promise<Booking> {
    const course = await this.resolveCourse(dto.course);
    const access = await this.entitlementFor(course, studentUserId);

    if (access.code === SLOT_ENTITLEMENT_CODES.NONE) throw notEntitled(access.denial);

    const from = new Date();
    const to = new Date(from.getTime() + BOOKING_HORIZON_DAYS * MS_PER_DAY);
    const startsAt = new Date(dto.startsAt);

    if (startsAt < from || startsAt >= to) {
      throw fieldError('startsAt', 'Pick a class from the coming month shown on the calendar.');
    }

    const windows = await this.rules.listActive(course.teacherUserId);
    const tile = slotAt(windows, course.teacher.timezone, startsAt);
    if (!tile) {
      throw fieldError('startsAt', 'This teacher does not keep a class open at that minute.');
    }

    const result = await this.bookings.request({
      studentUserId,
      teacherUserId: course.teacherUserId,
      courseId: course.id,
      startsAt: tile.startsAt,
      durationMinutes: Math.round(
        (tile.endsAt.getTime() - tile.startsAt.getTime()) / MS_PER_MINUTE,
      ),
      typeValueId: await this.reference.valueId(
        LKP_TYPE_CODES.BOOKING_TYPE,
        access.code === SLOT_ENTITLEMENT_CODES.DEMO
          ? BOOKING_TYPE_CODES.DEMO
          : BOOKING_TYPE_CODES.ENROLLED,
      ),
      pendingStatusValueId: await this.reference.valueId(
        LKP_TYPE_CODES.BOOKING_STATUS,
        BOOKING_STATUS_CODES.PENDING,
      ),
      blockingStatusValueIds: await this.statusIds(BLOCKING_BOOKING_STATUSES),
      // Filed by the insert, not by this method afterwards: a request the transaction rolled back
      // must not have a teacher told about it. Which of the two `requested` roads this was — a new
      // ask or a replay of the same one — is settled down there, and only the new one reaches this.
      notify: (tx, row) => this.mail.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_REQUESTED, row),
      // Filed on the same road the letter goes down, for the same reason: the record is of the ask
      // that was written, not of a button pressed twice. It names nothing the row does not already
      // hold — the minute, the length and whether this was a demo or a class the student had a place
      // in are all columns of the booking the insert just wrote.
      record: (tx, row) =>
        this.actions.record(tx, {
          action: ACTION_CODES.BOOKING_REQUESTED,
          targetId: row.id,
        }),
    });

    if (result.outcome === 'held') throw takenMinute();

    return toBooking(result.booking);
  }

  /**
   * Everything this student has booked, soonest first.
   *
   * No filter and no pagination, because the list is a student's own history with a handful of
   * teachers and a screen that wants next week has the starts to sort on. Carving "upcoming" into
   * the endpoint would put one portal's tab structure in the API, where the next screen to want a
   * different cut would have to argue with it.
   */
  async listOwned(studentUserId: string): Promise<Booking[]> {
    return (await this.bookings.listOwned(studentUserId)).map(toBooking);
  }

  /**
   * Leave a class.
   *
   * The response is the class as it now reads, in `cancelled`, and the minute it was holding goes
   * back on the teacher's calendar in the same write. The row itself stays: what a student booked
   * and gave up is a fact the demo cap and any future account of attendance both still need, and
   * releasing a seat has never meant erasing the person who sat in it.
   *
   * Pressing it twice is not an error, and that is a decision rather than an accident — a portal
   * whose cancel button timed out has no way to know whether the class stood down, and making the
   * retry answer `409` would turn a slow network into a screen that tells a student they are still
   * booked when they are not.
   *
   * A class that has already been taught, missed, refused or left to expire is the one thing a
   * student cannot undo here, and that comes back as a conflict rather than a field error: nothing
   * the student typed was wrong, the state of the class is.
   */
  async cancel(studentUserId: string, bookingId: string): Promise<Booking> {
    const cancelledStatusValueId = await this.reference.valueId(
      LKP_TYPE_CODES.BOOKING_STATUS,
      BOOKING_STATUS_CODES.CANCELLED,
    );
    const outcome = UUID.test(bookingId)
      ? await this.bookings.cancelOwned({
          bookingId,
          studentUserId,
          cancellableStatusValueIds: await this.statusIds(CANCELLABLE_BOOKING_STATUSES),
          cancelledStatusValueId,
          // The teacher is the one who has to know: the minute they were holding is free again, and
          // the queue decides who reads a `booking_cancelled` rather than this caller.
          notify: (tx, row) => this.mail.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_CANCELLED, row),
          // Which state the class was standing in when the student gave it up is read inside the
          // write rather than assumed here: taking back an ask and walking out of a class somebody
          // said yes to are two different decisions wearing one action code, and the row after the
          // swap says only the second half of either.
          record: (tx, change) =>
            this.actions.record(tx, {
              action: ACTION_CODES.BOOKING_CANCELLED,
              targetId: change.booking.id,
              detail: { from: change.from, to: BOOKING_STATUS_CODES.CANCELLED },
            }),
        })
      : ({ outcome: 'missing' } as const);

    if (outcome.outcome === 'missing') throw notFoundBooking();
    if (outcome.outcome === 'not-standing') throw nothingToCancel();
    if (outcome.outcome === 'changed') throw changedElsewhere();

    return toBooking(outcome.booking);
  }

  /**
   * The requests on this teacher's calendar that are still waiting for an answer.
   *
   * Read from the teacher rather than the course, because that is the shape of the decision: a
   * teacher with four courses keeps one list of people wanting Thursday, and a screen per course
   * would ask them to remember which shelf a request came from.
   */
  async requestsFor(teacherUserId: string): Promise<BookingRequest[]> {
    const pending = await this.reference.valueId(
      LKP_TYPE_CODES.BOOKING_STATUS,
      BOOKING_STATUS_CODES.PENDING,
    );
    return (await this.bookings.listRequests(teacherUserId, pending)).map(toRequest);
  }

  /**
   * The teacher's own calendar: every class on their week, answered or not.
   *
   * The two teacher reads split on the question, not the shape — `requestsFor` is the queue and
   * this is the schedule, and a row leaves the first the moment it is answered while it stays on
   * this one, because a class that was called off was still on that Tuesday. Same rule as the
   * student's list: no filter, no pagination, the screen decides what it calls upcoming.
   *
   * Names included, which is the one difference from the student's read of the same table: a
   * student looking at their own calendar already knows who they are.
   */
  async classesFor(teacherUserId: string): Promise<BookingRequest[]> {
    return (await this.bookings.listClasses(teacherUserId)).map(toRequest);
  }

  /**
   * Say yes or no to one of those requests.
   *
   * Only a pending row can be answered, and that is the load-bearing rule rather than a nicety:
   * a teacher taking back last week's confirmation, or overwriting a student's cancellation, would
   * both be a rewrite of something that already happened. A second press of the same answer is
   * harmless and comes back as the class as it now reads, for the same reason a repeated cancel
   * does — the button's response can be lost on the way home.
   *
   * Yes keeps the minute held and no gives it back, which is the only difference between the two
   * beyond the word on the row. Neither deletes anything: a refused class is still a class the
   * student asked for, and the reason they did not get it.
   *
   * Yes also gives the class somewhere to happen. The room's name is minted here, from a uuid and
   * nothing else, and written in the same statement as the status — so a request left to expire or
   * refused never held an address, and a confirmed class cannot exist without its room on a box
   * where video is configured. A deployment with `VIDEO_PROVIDER=none` is answered by the port
   * with null rather than by an `if` here, and the class simply has no door. The name travels no
   * further than this method: the list carries the window it opens in, and the address is the join
   * endpoint's to give (§6).
   */
  async answer(
    teacherUserId: string,
    bookingId: string,
    answer: 'confirm' | 'reject',
  ): Promise<Booking> {
    const pendingStatusValueId = await this.reference.valueId(
      LKP_TYPE_CODES.BOOKING_STATUS,
      BOOKING_STATUS_CODES.PENDING,
    );
    const answerStatusValueId = await this.reference.valueId(
      LKP_TYPE_CODES.BOOKING_STATUS,
      answer === 'confirm' ? BOOKING_STATUS_CODES.CONFIRMED : BOOKING_STATUS_CODES.REJECTED,
    );

    const outcome = UUID.test(bookingId)
      ? await this.bookings.answerOwned({
          bookingId,
          teacherUserId,
          pendingStatusValueId,
          answerStatusValueId,
          releaseHold: answer === 'reject',
          mintRoomName: answer === 'confirm' ? this.video.room(randomUUID())?.name : undefined,
          // One of the two answers, chosen by the same `answer` that chose the status. A confirm
          // filed as a refusal is not a bug in the copy but in this line, and it is the line that
          // decides what a student is told about their own class.
          notify: (tx, row) =>
            this.mail.aboutBooking(
              tx,
              answer === 'confirm'
                ? MAIL_EVENT_CODES.BOOKING_CONFIRMED
                : MAIL_EVENT_CODES.BOOKING_REFUSED,
              row,
            ),
          // The record of the answer is chosen by the same `answer` that chose the status and the
          // room, for the reason the note above gives about the letter: a confirm recorded as a
          // refusal is not a fault in the log but in this line.
          record: (tx, change) =>
            this.actions.record(tx, {
              action:
                answer === 'confirm'
                  ? ACTION_CODES.BOOKING_CONFIRMED
                  : ACTION_CODES.BOOKING_REFUSED,
              targetId: change.booking.id,
              detail: {
                from: change.from,
                to:
                  answer === 'confirm'
                    ? BOOKING_STATUS_CODES.CONFIRMED
                    : BOOKING_STATUS_CODES.REJECTED,
              },
            }),
        })
      : ({ outcome: 'missing' } as const);

    if (outcome.outcome === 'missing') throw notFoundBooking();
    if (outcome.outcome === 'not-standing') throw alreadyAnswered();
    if (outcome.outcome === 'changed') throw changedElsewhere();

    return toBooking(outcome.booking);
  }

  /**
   * Ask for the address of a live class, and be told whether you may have it.
   *
   * This is the only route in the platform that turns a stored room name into a URL, and the four
   * questions it asks are asked in the order that costs least: is this one of the two accounts the
   * class is about (the same silence for "not yours" as for "never there", so walking ids earns
   * nothing); does the class stand; does this deployment have rooms at all; and is it *now*.
   *
   * The window is the last one and it is enforced here rather than left to the screen, because a
   * portal that opened the door early would open it for anybody holding the name — which, on a
   * bridge with no password, is everybody. The refusal says which side of the window the caller is
   * on, and the too-early one carries the opening instant so a clock that disagrees with the
   * server's still counts down to the same minute.
   *
   * Nothing here is written: asking is a read of a fact the confirmation already settled, which is
   * why a second press answers with the same address rather than a new room.
   */
  async roomFor(userId: string, bookingId: string): Promise<BookingRoom> {
    const row = UUID.test(bookingId) ? await this.bookings.findRoomFor(bookingId, userId) : null;
    if (!row) throw notFoundBooking();
    if (row.status.code !== BOOKING_STATUS_CODES.CONFIRMED) throw nothingToJoin();
    if (!row.roomName) throw noLiveRoom();

    const endsAt = new Date(row.startsAt.getTime() + row.durationMinutes * MS_PER_MINUTE);
    const door = liveClassWindow(row.startsAt, endsAt);
    const now = new Date();
    if (now < door.opensAt) throw doorNotYet(door.opensAt);
    if (now > door.closesAt) throw doorShut();

    const room = this.video.room(row.roomName);
    if (!room) throw noLiveRoom();
    return { url: room.url };
  }

  /** A course this platform can take a booking for: published, live, and addressed either way. */
  private async resolveCourse(address: string): Promise<BookableCourseRow> {
    const published = await this.reference.valueId(
      LKP_TYPE_CODES.COURSE_STATUS,
      COURSE_STATUS_CODES.PUBLISHED,
    );
    const course = await this.bookings.findBookableCourse(
      UUID.test(address) ? { id: address } : { slug: address },
      published,
    );

    if (!course) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that course.',
      });
    }

    return course;
  }

  /** A place in the course, then the course's own invitation, then the student's history with it. */
  private async entitlementFor(
    course: BookableCourseRow,
    studentUserId: string,
  ): Promise<Entitlement> {
    const place = await this.enrollments.findPlace(studentUserId, course.id);
    if (place?.isActive) {
      return { code: SLOT_ENTITLEMENT_CODES.ENROLLED, denial: null };
    }

    if (!course.demoBookingsEnabled) {
      return { code: SLOT_ENTITLEMENT_CODES.NONE, denial: SLOT_DENIAL_CODES.ENROLLMENT_REQUIRED };
    }

    const [demo] = await this.reference.valuesByCodes(LKP_TYPE_CODES.BOOKING_TYPE, [
      BOOKING_TYPE_CODES.DEMO,
    ]);
    const alreadyTried = demo
      ? await this.bookings.hasDemoBooking(course.id, studentUserId, demo.id)
      : false;

    return alreadyTried
      ? { code: SLOT_ENTITLEMENT_CODES.NONE, denial: SLOT_DENIAL_CODES.DEMO_ALREADY_TAKEN }
      : { code: SLOT_ENTITLEMENT_CODES.DEMO, denial: null };
  }

  /** The lookup ids behind a set of status codes, refusing to answer with a shorter list than the
   * caller asked for: a status the code reaches but the seed does not carry would silently stop
   * blocking, cancelling or expiring a class. */
  private async statusIds(codes: readonly string[]): Promise<string[]> {
    const rows = await this.reference.valuesByCodes(LKP_TYPE_CODES.BOOKING_STATUS, codes);
    if (rows.length !== codes.length) {
      throw new Error(`Not every booking status in [${codes.join(', ')}] is seeded`);
    }
    return rows.map((row) => row.id);
  }
}
