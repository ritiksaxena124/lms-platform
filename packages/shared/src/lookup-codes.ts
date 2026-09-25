/**
 * Codes for database-backed reference rows (`LkpType` / `LkpValue`).
 *
 * These are the *only* place the string values may appear in code. They mirror seeded
 * rows: adding a value to a lookup table needs no code change, but reading a code that
 * is not seeded must fail loudly at seed-validation time (see `validateLookupSeeds`).
 * Business statuses are never TypeScript enums, so an unseeded value can never be
 * silently invented by a developer.
 */
export const LKP_TYPE_CODES = {
  USER_ROLE: 'UserRole',
  ACCOUNT_STATUS: 'AccountStatus',
  VERIFICATION_STATUS: 'VerificationStatus',
  BOOKING_TYPE: 'BookingType',
  BOOKING_STATUS: 'BookingStatus',
  MEETING_STATUS: 'MeetingStatus',
  COURSE_STATUS: 'CourseStatus',
  LESSON_KIND: 'LessonKind',
  ENROLLMENT_SOURCE: 'EnrollmentSource',
  SUBSCRIPTION_STATUS: 'SubscriptionStatus',
  BILLING_INTERVAL: 'BillingInterval',
  PAYMENT_STATUS: 'PaymentStatus',
  NOTIFICATION_TYPE: 'NotificationType',
  TEACHING_MODE: 'TeachingMode',
  COURSE_LEVEL: 'CourseLevel',
  MODERATION_STATUS: 'ModerationStatus',
} as const;

export type LkpTypeCode = (typeof LKP_TYPE_CODES)[keyof typeof LKP_TYPE_CODES];

export const ROLE_CODES = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  OPS: 'ops',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export const BOOKING_STATUS_CODES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  NO_SHOW: 'no_show',
} as const;

/** Bookings in these statuses still occupy the teacher's slot. */
export const BLOCKING_BOOKING_STATUSES: readonly string[] = [
  BOOKING_STATUS_CODES.PENDING,
  BOOKING_STATUS_CODES.CONFIRMED,
];

export const VERIFICATION_STATUS_CODES = {
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
} as const;

export function validateLookupSeeds(seeded: Record<LkpTypeCode, readonly string[]>): void {
  for (const typeCode of Object.values(LKP_TYPE_CODES)) {
    if (!Array.isArray(seeded[typeCode])) {
      throw new Error(`Lookup seed missing for reference type ${typeCode}`);
    }
  }
}
