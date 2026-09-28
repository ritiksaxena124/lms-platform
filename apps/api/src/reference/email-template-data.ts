import { MAIL_EVENT_CODES, type MailEventCode } from '@lms/shared';

/** The copy half of one send decision — exactly the columns of an `email_template` row an operator
 * may reword, and nothing else. No address, no recipient, no id: the destination belongs to the
 * transaction that noticed the news (§6), and a row holding both would be a row holding a link. */
export interface EmailTemplateSeed {
  subject: string;
  heading: string;
  /** One sentence per element, in the order the body shows them. */
  bodyLines: string[];
  ctaLabel: string;
}

/** The four answers a payload can carry, named in the copy with `{braces}`:
 * `{student_name}`, `{teacher_name}`, `{course_title}`, `{when}`. */
export const EMAIL_TEMPLATE_SEEDS: Record<MailEventCode, EmailTemplateSeed> = {
  [MAIL_EVENT_CODES.BOOKING_REQUESTED]: {
    subject: '{student_name} asked for a class in {course_title}',
    heading: 'A request for {when}',
    bodyLines: [
      '{student_name} holds a place in {course_title} and wants that minute of your week.',
      'The time is held for them until you answer. If you do not, it goes back on your calendar by itself.',
    ],
    ctaLabel: 'Answer the request',
  },
  [MAIL_EVENT_CODES.BOOKING_CONFIRMED]: {
    subject: 'Your class in {course_title} is confirmed',
    heading: '{teacher_name} confirmed {when}',
    bodyLines: [
      'It is on your calendar now, and cancelling gives the minute back.',
      'If the class has a live room, its address is on the class page and not in this message — open it once the door does.',
    ],
    ctaLabel: 'See my classes',
  },
  [MAIL_EVENT_CODES.BOOKING_REFUSED]: {
    subject: '{teacher_name} could not take {when}',
    heading: 'That request did not go through',
    bodyLines: [
      '{teacher_name} said no to the class you asked for in {course_title}, so the minute is back on their calendar.',
      'Nothing else you hold moved. Ask again whenever their week shows an opening.',
    ],
    ctaLabel: 'See what is open',
  },
  [MAIL_EVENT_CODES.BOOKING_EXPIRED]: {
    subject: 'No answer on your request for {when}',
    heading: 'That request has run out',
    bodyLines: [
      '{teacher_name} did not answer the class you asked for in {course_title}, so the minute went back on their calendar.',
      'You can ask for the same time again if it is showing, or pick another one.',
    ],
    ctaLabel: 'See what is open',
  },
  [MAIL_EVENT_CODES.BOOKING_CANCELLED]: {
    subject: '{student_name} left the class on {when}',
    heading: 'A minute of your week is free again',
    bodyLines: [
      '{student_name} cancelled their class in {course_title}.',
      'The time is back on your calendar for someone else to ask for, and the class stays on your list as the cancellation it was.',
    ],
    ctaLabel: 'See your classes',
  },
  [MAIL_EVENT_CODES.ENROLLMENT_JOINED]: {
    subject: 'You are in {course_title}',
    heading: 'Your place in {course_title} is open',
    bodyLines: [
      '{teacher_name} runs this course, and every page it offers is readable to you from now on.',
      'Classes come from the teacher’s own calendar — the booking page under the course shows what is open.',
    ],
    ctaLabel: 'Open the course',
  },
  [MAIL_EVENT_CODES.ENROLLMENT_LEFT]: {
    subject: 'You left {course_title}',
    heading: 'Your place in {course_title} is closed',
    bodyLines: [
      'The lessons that place opened are closed with it. Anything you already booked stays booked.',
      'Taking the place again reopens the same pages from the same row — the day you first arrived does not move.',
    ],
    ctaLabel: 'See my courses',
  },
};
