import {
  ACCOUNT_STATUS_CODES,
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
};

export const REQUIRED_LKP_TYPES = Object.keys(LOOKUP_SEEDS) as LkpTypeCode[];
