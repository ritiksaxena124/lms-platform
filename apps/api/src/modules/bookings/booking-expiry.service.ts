import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BOOKING_STATUS_CODES,
  LKP_TYPE_CODES,
  MAIL_EVENT_CODES,
  PENDING_REQUEST_HOURS,
} from '@lms/shared';

import { AppLogger } from '../../common/logging/app-logger.service';
import { ReferenceService } from '../../reference/reference.service';
import { MailQueue } from '../notifications/mail-queue.service';
import { BookingsRepository } from './bookings.repository';

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Ends the requests a teacher never answered.
 *
 * A held minute with no decision on it is the worst state the booking table can be in. The teacher
 * has not said yes, the student has not got a class, and no other student can be given the time —
 * so the hold has to end by itself, because the alternative is waiting on a person who has already
 * not replied.
 *
 * Two clocks run it out, and both are needed. `PENDING_REQUEST_HOURS` of silence is the teacher's
 * answer in itself; and a class whose minute has arrived without a yes was never going to happen,
 * however recently it was asked for. The hours come from the shared constant rather than a number
 * in a cron expression, because the window is a business rule the portals quote back to students
 * and not a scheduling preference of this file.
 *
 * Nothing is deleted. An unanswered request stays on the record as `expired`, which is the honest
 * thing it was: a class a student asked for that went nowhere. It also keeps the demo cap counting
 * a demo that was tried, because a teacher's silence is not the student's second chance.
 *
 * The rule lives here rather than in a status column a trigger keeps current, so the sweep and the
 * two doors that answer a request by hand (`BookingsService.answer`, `BookingsService.cancel`) are
 * the same kind of thing: three ways a pending row stops being pending, all of them in code.
 */
@Injectable()
export class BookingExpiryService {
  private readonly logger = new AppLogger();

  constructor(
    private readonly bookings: BookingsRepository,
    private readonly reference: ReferenceService,
    private readonly mail: MailQueue,
  ) {}

  /**
   * Run the sweep on the wall clock.
   *
   * Hourly rather than nightly, so the worst a silent teacher costs a student is an hour of a
   * calendar that looks booked, and so a class whose minute has just passed is given back within
   * the hour it was wasted. Overlapping runs and two API instances on one database are both
   * harmless — see the note on `BookingsRepository.expirePending`.
   *
   * The job is named so the scheduler keeps it addressable rather than under a generated uuid:
   * `booking-request-expiry` is what an operator stops, restarts or greps for in the logs.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'booking-request-expiry' })
  async sweepStaleRequests(): Promise<void> {
    const expired = await this.expireStale(new Date());
    if (expired > 0) {
      this.logger.log(`Expired ${expired} unanswered class request(s)`, 'BookingExpiry');
    }
  }

  /**
   * End the requests that have run out as of `now`, returning how many.
   *
   * The clock is a parameter because every question this answers is about time, and a test that
   * wants to know what happens after a day of silence should not have to wait for it. Production
   * passes the moment it is standing in; `now` is not a way of moving a row's own history, which is
   * why the tests make their fixtures old instead of making this call early.
   */
  async expireStale(now: Date): Promise<number> {
    const pendingStatusValueId = await this.reference.valueId(
      LKP_TYPE_CODES.BOOKING_STATUS,
      BOOKING_STATUS_CODES.PENDING,
    );
    const expiredStatusValueId = await this.reference.valueId(
      LKP_TYPE_CODES.BOOKING_STATUS,
      BOOKING_STATUS_CODES.EXPIRED,
    );

    return this.bookings.expirePending({
      pendingStatusValueId,
      expiredStatusValueId,
      olderThan: new Date(now.getTime() - PENDING_REQUEST_HOURS * MS_PER_HOUR),
      at: now,
      // The one send decision with nobody pressing a button for it, which is exactly why it needs
      // one: a student who was promised an answer has to be told the answer was silence. Filed per
      // row the sweep actually ended — see `BookingsRepository.expirePending`.
      notify: (tx, row) => this.mail.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_EXPIRED, row),
    });
  }
}
