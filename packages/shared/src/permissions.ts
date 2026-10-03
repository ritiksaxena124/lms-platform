import { ROLE_CODES, type RoleCode } from './lookup-codes';

/**
 * The capabilities a route can ask for.
 *
 * These are not reference rows. `LkpValue` carries the codes an operator may add to without a
 * release (§3), and a permission is not one of those: the routes name these strings in their
 * decorators, so a capability that exists only in a table would be a door no code opens. The list
 * lives here, next to the matrix that hands it out, and both change in the same commit as the route.
 *
 * A code names a decision the platform lets somebody make — `course.author`, `booking.answer` — not
 * the person who makes it. That is the whole point of the split: three accounts exist today, and the
 * day a fourth arrives (a teaching assistant who runs a class but writes no course) it is one row in
 * `ROLE_PERMISSIONS` rather than sixty route annotations read again.
 */
export const PERMISSION_CODES = {
  ACCOUNT_MANAGE: 'account.manage',
  ACTIVITY_READ: 'activity.read',
  AVAILABILITY_MANAGE: 'availability.manage',
  BOOKING_ANSWER: 'booking.answer',
  BOOKING_REQUEST: 'booking.request',
  CLASS_ATTEND: 'class.attend',
  CLASS_SCHEDULE: 'class.schedule',
  CLASS_TEACH: 'class.teach',
  COUPON_MANAGE: 'coupon.manage',
  COURSE_AUTHOR: 'course.author',
  ENROLLMENT_HOLD: 'enrollment.hold',
  MEDIA_UPLOAD: 'media.upload',
  NOTIFICATION_QUEUE_READ: 'notification.queue.read',
  ROSTER_READ: 'roster.read',
  TEACHER_PROFILE_MANAGE: 'teacher.profile.manage',
} as const;

export type PermissionCode = (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES];

const PERMISSION_VALUES: readonly string[] = Object.values(PERMISSION_CODES);

/** What each account may do, as one table. The guard's entire policy, and the only place to look. */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  [ROLE_CODES.STUDENT]: [
    PERMISSION_CODES.BOOKING_REQUEST,
    PERMISSION_CODES.CLASS_ATTEND,
    PERMISSION_CODES.ENROLLMENT_HOLD,
  ],
  [ROLE_CODES.TEACHER]: [
    PERMISSION_CODES.AVAILABILITY_MANAGE,
    PERMISSION_CODES.BOOKING_ANSWER,
    PERMISSION_CODES.CLASS_SCHEDULE,
    PERMISSION_CODES.CLASS_TEACH,
    PERMISSION_CODES.COURSE_AUTHOR,
    PERMISSION_CODES.COUPON_MANAGE,
    PERMISSION_CODES.MEDIA_UPLOAD,
    PERMISSION_CODES.ROSTER_READ,
    PERMISSION_CODES.TEACHER_PROFILE_MANAGE,
  ],
  [ROLE_CODES.OPS]: [
    PERMISSION_CODES.ACCOUNT_MANAGE,
    PERMISSION_CODES.ACTIVITY_READ,
    PERMISSION_CODES.NOTIFICATION_QUEUE_READ,
  ],
};

/** The capabilities a role holds, or an empty list for a role the platform does not know. */
export function permissionsForRole(role: string): readonly PermissionCode[] {
  return ROLE_PERMISSIONS[role as RoleCode] ?? [];
}

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && PERMISSION_VALUES.includes(value);
}

/** Which roles the matrix hands this capability to, in the order the roles are declared. */
export function heldByRoles(code: PermissionCode): RoleCode[] {
  return (Object.keys(ROLE_PERMISSIONS) as RoleCode[]).filter((role) =>
    ROLE_PERMISSIONS[role].includes(code),
  );
}
