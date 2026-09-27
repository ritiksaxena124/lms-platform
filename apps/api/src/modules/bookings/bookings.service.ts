import { Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  BLOCKING_BOOKING_STATUSES,
  BOOKING_HORIZON_DAYS,
  BOOKING_TYPE_CODES,
  COURSE_STATUS_CODES,
  LKP_TYPE_CODES,
  SLOT_DENIAL_CODES,
  SLOT_ENTITLEMENT_CODES,
  expandWindows,
  type OpenSlot,
  type OpenSlotsResponse,
  type SlotDenialCode,
  type SlotEntitlementCode,
} from '@lms/shared';

import { AvailabilityRepository } from '../availability/availability.repository';
import { EnrollmentsRepository } from '../enrollments/enrollments.repository';
import { ReferenceService } from '../../reference/reference.service';
import type { BookableCourseRow } from './bookings.repository';
import { BookingsRepository } from './bookings.repository';

/** A course is addressed by the id the API issued or the slug a link carries; a shape that
 * cannot be an id is read as a slug, which is the rule the catalog already runs on. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
