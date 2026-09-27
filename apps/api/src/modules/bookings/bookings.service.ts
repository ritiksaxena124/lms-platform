import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  API_ERROR_CODES,
  BLOCKING_BOOKING_STATUSES,
  BOOKING_HORIZON_DAYS,
  BOOKING_STATUS_CODES,
  BOOKING_TYPE_CODES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  SLOT_DENIAL_CODES,
  SLOT_ENTITLEMENT_CODES,
  expandWindows,
  slotAt,
  type Booking,
  type BookingStatusCode,
  type BookingTypeCode,
  type OpenSlot,
  type OpenSlotsResponse,
  type SlotDenialCode,
  type SlotEntitlementCode,
} from '@lms/shared';

import { AvailabilityRepository } from '../availability/availability.repository';
import { EnrollmentsRepository } from '../enrollments/enrollments.repository';
import { ReferenceService } from '../../reference/reference.service';
import type { BookingRow } from './bookings.repository';
import type { BookableCourseRow } from './bookings.repository';
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
 * row instead of being re-derived from the rules at display time. */
function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    course: { id: row.courseId },
    type: row.type.code as BookingTypeCode,
    status: row.status.code as BookingStatusCode,
    startsAt: row.startsAt.toISOString(),
    endsAt: new Date(row.startsAt.getTime() + row.durationMinutes * MS_PER_MINUTE).toISOString(),
    durationMinutes: row.durationMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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

/**
 * Who this student is to this course, or the reason they are nobody to it.
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
 * two facts that make an offer undeliverable. A minute already held by a standing booking goes,
 * and a minute already gone by never arrives.
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
    const held = await this.bookings.heldStarts(
      course.teacherUserId,
      await this.blockingStatusIds(),
      from,
      to,
    );
    const taken = new Set(held.map((startsAt) => startsAt.getTime()));
    const slots: OpenSlot[] = expandWindows(windows, course.teacher.timezone, { from, to })
      .filter((slot) => !taken.has(slot.startsAt.getTime()))
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
      blockingStatusValueIds: await this.blockingStatusIds(),
    });

    if (result.outcome === 'held') throw takenMinute();

    return toBooking(result.booking);
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

  /** The statuses that occupy a minute, resolved from the shared list rather than a query that
   * could not answer it: the table holds lookup ids and knows nothing about vocabulary. */
  private async blockingStatusIds(): Promise<string[]> {
    const rows = await this.reference.valuesByCodes(
      LKP_TYPE_CODES.BOOKING_STATUS,
      BLOCKING_BOOKING_STATUSES,
    );
    if (rows.length !== BLOCKING_BOOKING_STATUSES.length) {
      throw new Error('Not every blocking booking status is seeded');
    }
    return rows.map((row) => row.id);
  }
}
