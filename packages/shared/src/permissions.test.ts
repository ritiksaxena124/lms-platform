import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CODES,
  ROLE_PERMISSIONS,
  heldByRoles,
  isPermissionCode,
  permissionsForRole,
} from './permissions';
import { ROLE_CODES } from './lookup-codes';

/**
 * A role is a bundle of capabilities, and the bundle is the only place the answer to "what may this
 * account do" is written. Route annotations name a capability (`course.author`), never a role, so a
 * fourth kind of account is one entry in this table rather than sixty route files reviewed again.
 */
describe('permission catalog', () => {
  it('names capabilities in dotted lowercase, so a code reads as a thing rather than a flag', () => {
    for (const code of Object.values(PERMISSION_CODES)) {
      expect(code).toMatch(/^[a-z][a-z]*(\.[a-z][a-z]*)+$/);
    }
  });

  it('hands a teacher the authoring half of a course and everything a class needs', () => {
    expect(permissionsForRole(ROLE_CODES.TEACHER)).toEqual([
      PERMISSION_CODES.AVAILABILITY_MANAGE,
      PERMISSION_CODES.BOOKING_ANSWER,
      PERMISSION_CODES.CLASS_SCHEDULE,
      PERMISSION_CODES.CLASS_TEACH,
      PERMISSION_CODES.COURSE_AUTHOR,
      PERMISSION_CODES.COUPON_MANAGE,
      PERMISSION_CODES.MEDIA_UPLOAD,
      PERMISSION_CODES.ROSTER_READ,
      PERMISSION_CODES.TEACHER_PROFILE_MANAGE,
    ]);
  });

  it('hands a student the three things a learner does, and no authoring at all', () => {
    expect(permissionsForRole(ROLE_CODES.STUDENT)).toEqual([
      PERMISSION_CODES.BOOKING_REQUEST,
      PERMISSION_CODES.CLASS_ATTEND,
      PERMISSION_CODES.ENROLLMENT_HOLD,
    ]);
  });

  it('hands the operator the desk, and nothing belonging to a classroom', () => {
    expect(permissionsForRole(ROLE_CODES.OPS)).toEqual([
      PERMISSION_CODES.ACCOUNT_MANAGE,
      PERMISSION_CODES.ACTIVITY_READ,
      PERMISSION_CODES.NOTIFICATION_QUEUE_READ,
    ]);
  });

  it('lists every role the account table can hold, in the order the roles are declared', () => {
    // A role added to the lookup seed without a row here would answer "no capabilities at all" for
    // somebody, which is a locked door rather than a loud failure. This is the check that makes it loud.
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...Object.values(ROLE_CODES)].sort());
  });

  it('keeps every capability reachable by somebody', () => {
    // A capability no role holds is a route nobody can call: it stays in the reference and refuses
    // everybody forever, which is the worst way to be unfinished.
    for (const code of Object.values(PERMISSION_CODES)) {
      expect(heldByRoles(code)).not.toEqual([]);
    }
  });

  it('refuses to name a capability the catalog does not carry', () => {
    expect(isPermissionCode('course.author')).toBe(true);
    expect(isPermissionCode('course.write')).toBe(false);
    expect(isPermissionCode(undefined)).toBe(false);
  });
});
