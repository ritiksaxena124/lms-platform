import { Inject, Injectable } from '@nestjs/common';
import type { MailOutbox, Prisma } from '@prisma/client';
import { MAIL_EVENT_CODES, formatInZone } from '@lms/shared';

import type { AppEnv } from '../../config/env';
import { ENV } from '../../config/env.module';

/** The part of the environment a message needs to be pointed at something. Spelled out rather than
 * taken as a whole `AppEnv` so a spec can hand the queue two URLs and nothing else. */
type PortalOrigins = Pick<AppEnv, 'TEACHER_PORTAL_URL' | 'STUDENT_PORTAL_URL'>;

/** A person a message can be addressed to, and the two facts the queue reads about them: who they
 * are called, and which clock their `when` is written on (§5). Never their address — see `file`. */
export interface MailParty {
  id: string;
  fullName: string;
  timezone: string;
}

export interface BookingNews {
  /** Only the id and the title: the id is the page a student is sent back to, the title is what the
   * copy names. A slug would be a second way to address the same course, and one of them would
   * eventually be the stale one. */
  course: { id: string; title: string };
  student: MailParty;
  teacher: MailParty;
  startsAt: Date;
}

export interface EnrollmentNews {
  course: { id: string; title: string; teacherName: string };
  student: { id: string };
}

/** The five send decisions a `booking` row makes, and the two a `place` in a course makes. Listed
 * here rather than inferred from `MailEventCode` so a caller cannot pass an enrollment event to the
 * booking half of the queue and have it compile. */
export const BOOKING_MAIL_EVENTS = [
  MAIL_EVENT_CODES.BOOKING_REQUESTED,
  MAIL_EVENT_CODES.BOOKING_CONFIRMED,
  MAIL_EVENT_CODES.BOOKING_REFUSED,
  MAIL_EVENT_CODES.BOOKING_EXPIRED,
  MAIL_EVENT_CODES.BOOKING_CANCELLED,
] as const;

export const ENROLLMENT_MAIL_EVENTS = [
  MAIL_EVENT_CODES.ENROLLMENT_JOINED,
  MAIL_EVENT_CODES.ENROLLMENT_LEFT,
] as const;

export type BookingMailEvent = (typeof BOOKING_MAIL_EVENTS)[number];
export type EnrollmentMailEvent = (typeof ENROLLMENT_MAIL_EVENTS)[number];

/** What a row's `payload` holds: the answers the copy asks for, and the one place its button goes.
 * The shape mirrors `renderEmail`'s arguments, because that is the only thing that will read it —
 * in 6e's sweep, from this row, with the template fetched by `eventCode`.
 *
 * The `href` is always present. Whether a message shows a button is the copy's decision: an operator
 * who clears a `cta_label` turns the event into a notice, and the sweep passes no action for a row
 * that asks for none.
 *
 * A type rather than an interface because Prisma's `Json` column only takes a value TypeScript will
 * give an index signature to, and it will give one to a type alias and not to an interface. */
export type MailEnvelope = {
  slots: Record<string, string>;
  href: string;
};

/** Which of the two parties a class news story is *about*, in the sense of who has to read it.
 *
 * The event decides this, not the caller: a request and a cancellation are both things happening on
 * the teacher's calendar, and the other three are what a student asked and got. Settled once here is
 * the difference between a confirmation reaching the person who booked it and reaching the person
 * who wrote it.
 */
function readBy(event: BookingMailEvent): 'student' | 'teacher' {
  return event === MAIL_EVENT_CODES.BOOKING_REQUESTED ||
    event === MAIL_EVENT_CODES.BOOKING_CANCELLED
    ? 'teacher'
    : 'student';
}

/** The page a class message sends its reader to, in the portal that page lives in.
 *
 * An unanswered request and a refused one both end at the course's booking page — the student's next
 * act is to ask for a different minute — while a confirmed class is on a list they no longer have to
 * act on. Nothing here is a URL a caller passed: the paths are these strings, and the only value
 * interpolated is the course id, encoded below.
 */
function bookingPage(
  event: BookingMailEvent,
  course: { id: string },
): { portal: keyof PortalOrigins; segments: string[] } {
  switch (event) {
    case MAIL_EVENT_CODES.BOOKING_REQUESTED:
      return { portal: 'TEACHER_PORTAL_URL', segments: ['requests'] };
    case MAIL_EVENT_CODES.BOOKING_CANCELLED:
      return { portal: 'TEACHER_PORTAL_URL', segments: ['classes'] };
    case MAIL_EVENT_CODES.BOOKING_CONFIRMED:
      return { portal: 'STUDENT_PORTAL_URL', segments: ['my-classes'] };
    default:
      return { portal: 'STUDENT_PORTAL_URL', segments: ['courses', course.id, 'book'] };
  }
}

function enrollmentPage(
  event: EnrollmentMailEvent,
  course: { id: string },
): { portal: keyof PortalOrigins; segments: string[] } {
  return event === MAIL_EVENT_CODES.ENROLLMENT_JOINED
    ? { portal: 'STUDENT_PORTAL_URL', segments: ['courses', course.id] }
    : { portal: 'STUDENT_PORTAL_URL', segments: ['my-courses'] };
}

/**
 * Files what just happened, so something else can send it later.
 *
 * Three absences are the design.
 *
 * **No address.** The row names a recipient by their user id and the sweep reads the address off
 * that row at delivery time (6a's port says the outbox owns the address book). A stored address
 * would go stale the day a person changed it, and would put personal data in a table a report can
 * join.
 *
 * **No letter.** The payload is the news in the four answers the copy asks for; the sentences are
 * written at delivery, so a reword applies to what is already queued and a template edit cannot
 * quietly change a fact somebody was told.
 *
 * **No claim about sending.** `status`, `attempts` and `next_attempt_at` are the column defaults 6c
 * chose, so this class cannot say a message went out. On a box with no transport the row is dropped
 * by the sweep, and the queue would have been wrong.
 *
 * Every method takes the caller's `Prisma.TransactionClient`, not the repository's own client. That
 * is the point rather than a style: the letter is filed in the transaction that made the news, so a
 * write that rolls back cannot leave a message behind about a class that never happened.
 */
@Injectable()
export class MailQueue {
  constructor(@Inject(ENV) private readonly env: PortalOrigins) {}

  async aboutBooking(
    tx: Prisma.TransactionClient,
    event: BookingMailEvent,
    news: BookingNews,
  ): Promise<MailOutbox> {
    const reader = readBy(event);
    const recipient = reader === 'student' ? news.student : news.teacher;
    const other = reader === 'student' ? news.teacher : news.student;

    // A letter names the other person and never its reader: a teacher is told who is asking, a
    // student who answered. `when` is the same instant read in two different clocks, which is why
    // the recipient's zone is the one that matters here and not the class's.
    const slots: Record<string, string> = {
      [reader === 'student' ? 'teacher_name' : 'student_name']: other.fullName,
      course_title: news.course.title,
      when: formatInZone(news.startsAt, recipient.timezone).label,
    };

    return this.file(tx, event, recipient.id, slots, bookingPage(event, news.course));
  }

  async aboutEnrollment(
    tx: Prisma.TransactionClient,
    event: EnrollmentMailEvent,
    news: EnrollmentNews,
  ): Promise<MailOutbox> {
    const slots: Record<string, string> = { course_title: news.course.title };
    if (event === MAIL_EVENT_CODES.ENROLLMENT_JOINED) {
      slots.teacher_name = news.course.teacherName;
    }

    // Both of these go to the student: a place is theirs to take and theirs to leave, and a teacher
    // who wants to know reads their roster, which is a page rather than a letter.
    return this.file(tx, event, news.student.id, slots, enrollmentPage(event, news.course));
  }

  private async file(
    tx: Prisma.TransactionClient,
    event: BookingMailEvent | EnrollmentMailEvent,
    recipientUserId: string,
    slots: Record<string, string>,
    page: { portal: keyof PortalOrigins; segments: string[] },
  ): Promise<MailOutbox> {
    const envelope: MailEnvelope = { slots, href: this.portalUrl(page) };

    return tx.mailOutbox.create({
      data: { eventCode: event, recipientUserId, payload: envelope },
    });
  }

  /** An origin the deployment configured, and a path this file wrote.
   *
   * Encoding every segment is what makes that sentence true: a course id is a uuid this platform
   * issued, and if a caller ever handed over something shaped like `../../evil.example` instead,
   * what reaches the URL is `%2F..%2Fevil.example` — still a page on the portal, and no way for a
   * notification to point at a host nobody approved. Which includes no room address: a Jitsi URL is
   * a secret with a URL's shape (§10), and there is nothing in this signature it could arrive
   * through.
   */
  private portalUrl(page: { portal: keyof PortalOrigins; segments: string[] }): string {
    const origin = this.env[page.portal];
    return new URL(`/${page.segments.map(encodeURIComponent).join('/')}`, origin).toString();
  }
}
