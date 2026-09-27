import {
  ACCOUNT_STATUS_CODES,
  BOOKING_STATUS_CODES,
  BOOKING_TYPE_CODES,
  COURSE_LEVEL_CODES,
  COURSE_STATUS_CODES,
  CURRENCY_CODES,
  LESSON_STATUS_CODES,
  LKP_TYPE_CODES,
  type LkpTypeCode,
  ROLE_CODES,
  VERIFICATION_STATUS_CODES,
} from '@lms/shared';

export interface LookupValueSeed {
  code: string;
  /** What Ops sees in a dropdown. The code is for machines and never appears in UI. */
  label: string;
}

export interface LookupTypeSeed {
  description: string;
  /** Order here becomes `position`, which is the order a picker shows. */
  values: LookupValueSeed[];
}

const at = (code: string, label: string): LookupValueSeed => ({ code, label });

/**
 * The reference rows this phase reads — and nothing more. `LKP_TYPE_CODES` names every
 * type the product will eventually have; seeding a booking status before bookings exist
 * would put vocabulary in the database that no code enforces, which is exactly the drift
 * lookup tables are meant to prevent.
 */
export const LOOKUP_SEEDS: Partial<Record<LkpTypeCode, LookupTypeSeed>> = {
  [LKP_TYPE_CODES.USER_ROLE]: {
    description: 'Which portal an account may open',
    values: [
      at(ROLE_CODES.STUDENT, 'Student'),
      at(ROLE_CODES.TEACHER, 'Teacher'),
      at(ROLE_CODES.OPS, 'Operations'),
    ],
  },
  [LKP_TYPE_CODES.ACCOUNT_STATUS]: {
    description: 'Whether an account may sign in',
    values: [
      at(ACCOUNT_STATUS_CODES.ACTIVE, 'Active'),
      at(ACCOUNT_STATUS_CODES.DISABLED, 'Disabled'),
    ],
  },
  [LKP_TYPE_CODES.VERIFICATION_STATUS]: {
    description: 'Review state of a teacher document pack',
    values: [
      at(VERIFICATION_STATUS_CODES.UNVERIFIED, 'Unverified'),
      at(VERIFICATION_STATUS_CODES.PENDING, 'Pending review'),
      at(VERIFICATION_STATUS_CODES.VERIFIED, 'Verified'),
      at(VERIFICATION_STATUS_CODES.REJECTED, 'Rejected'),
    ],
  },
  /**
   * What a teacher can say they teach, and what a student searches by later. A list of
   * rows rather than a list of strings in code because the catalogue is a business
   * decision: Ops adds "Electronics" between two releases without a deploy, and a
   * retired subject stays reservable because old profiles still point at it.
   */
  [LKP_TYPE_CODES.SUBJECT]: {
    description: 'Subjects a teacher may offer and a student may search for',
    values: [
      at('mathematics', 'Mathematics'),
      at('physics', 'Physics'),
      at('chemistry', 'Chemistry'),
      at('biology', 'Biology'),
      at('english', 'English'),
      at('computer_science', 'Computer Science'),
      at('spoken_english', 'Spoken English'),
    ],
  },
  /**
   * The two vocabularies a course is written in. Level is a lookup rather than a union of
   * strings because Ops decides how many tiers the catalogue has — a fourth level for
   * exam-only batches is a database row, not a release.
   */
  [LKP_TYPE_CODES.COURSE_STATUS]: {
    description: 'Where a course is in its own life',
    values: [
      at(COURSE_STATUS_CODES.DRAFT, 'Draft'),
      at(COURSE_STATUS_CODES.PUBLISHED, 'Published'),
      at(COURSE_STATUS_CODES.ARCHIVED, 'Archived'),
    ],
  },
  [LKP_TYPE_CODES.COURSE_LEVEL]: {
    description: 'Who a course is written for',
    values: [
      at(COURSE_LEVEL_CODES.BEGINNER, 'Beginner'),
      at(COURSE_LEVEL_CODES.INTERMEDIATE, 'Intermediate'),
      at(COURSE_LEVEL_CODES.ADVANCED, 'Advanced'),
    ],
  },
  /**
   * What a price is quoted in. Seeded as a lookup rather than checked into the money helper
   * because the platform's list of currencies is a business decision, and a course priced in
   * a retired currency still has to say what its number meant (§2 — the row stays reservable).
   */
  [LKP_TYPE_CODES.CURRENCY]: {
    description: 'The money a course price is quoted in',
    values: [at(CURRENCY_CODES.INR, 'Indian rupee'), at(CURRENCY_CODES.USD, 'US dollar')],
  },
  /**
   * A lesson's own stage, one shorter than a course's: a lesson is retired by leaving the
   * syllabus, not by a status that says so. `LessonKind` stays unseeded for now — a lesson
   * is one block of text in this phase, and a kind column with no code that reads it would
   * be vocabulary in the database that nothing enforces.
   */
  [LKP_TYPE_CODES.LESSON_STATUS]: {
    description: 'Whether a lesson is still being written',
    values: [
      at(LESSON_STATUS_CODES.DRAFT, 'Draft'),
      at(LESSON_STATUS_CODES.PUBLISHED, 'Published'),
    ],
  },
  /**
   * The booking vocabulary Phase 4 schedules against. Kind decides who may take a slot and
   * status decides whether it is still held. Only the statuses a Phase 4 transition can reach
   * are seeded — `rejected` is reserved for a moderation flow (§6) and seeding an unreachable
   * row is exactly the drift a lookup table is meant to prevent (§3).
   */
  [LKP_TYPE_CODES.BOOKING_TYPE]: {
    description: 'What entitlement holds a booked slot',
    values: [at(BOOKING_TYPE_CODES.ENROLLED, 'Enrolled'), at(BOOKING_TYPE_CODES.DEMO, 'Demo')],
  },
  [LKP_TYPE_CODES.BOOKING_STATUS]: {
    description: 'Where a booked slot is in its own life',
    values: [
      at(BOOKING_STATUS_CODES.PENDING, 'Pending'),
      at(BOOKING_STATUS_CODES.CONFIRMED, 'Confirmed'),
      at(BOOKING_STATUS_CODES.CANCELLED, 'Cancelled'),
      at(BOOKING_STATUS_CODES.COMPLETED, 'Completed'),
      at(BOOKING_STATUS_CODES.NO_SHOW, 'No show'),
    ],
  },
};

export const REQUIRED_LKP_TYPES = Object.keys(LOOKUP_SEEDS) as LkpTypeCode[];
