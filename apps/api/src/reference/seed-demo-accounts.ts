import type { PrismaClient } from '@prisma/client';
import { ACCOUNT_STATUS_CODES, LKP_TYPE_CODES, ROLE_CODES, type RoleCode } from '@lms/shared';

import type { PasswordHasher } from '../modules/auth/password-hasher.service';

/**
 * The password for every demo account, published in the README on purpose. It is not a
 * secret and must never become one: the value of these accounts is that anyone testing the
 * POC can be signed in within a minute, and a password nobody remembers defeats that.
 */
export const DEMO_PASSWORD = 'lms-demo-password';

export interface DemoAccount {
  email: string;
  fullName: string;
  role: RoleCode;
}

/**
 * A known password is only survivable on addresses that belong to nobody, so every one of
 * these is under the reserved `.test` domain — a real address here would be a mailbox that
 * a documented credential can receive mail in.
 *
 * `ops` is the account registration cannot make: it is absent from the sign-up form on
 * purpose, and without a seeder there would be no way to look at the platform through the
 * eyes that approve teachers and retire a listing.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'teacher@example.test', fullName: 'Aditi Sharma', role: ROLE_CODES.TEACHER },
  { email: 'student@example.test', fullName: 'Rohan Mehta', role: ROLE_CODES.STUDENT },
  { email: 'ops@example.test', fullName: 'Ops Desk', role: ROLE_CODES.OPS },
];

/** Fails rather than warns: a documented password must never be minted on a live server. */
export function assertDemoSeedAllowed(nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to seed demo accounts in production; their password is published in the README',
    );
  }
}

/**
 * Insert-only, like the reference seeder: an account that already exists keeps whatever it
 * has become. Re-running this after someone changed a password, disabled an account or
 * renamed themselves during a test must not quietly hand that account back to the README.
 *
 * The production check lives here as well as in the CLI on purpose. `db:seed` *skips* demo
 * accounts in production so that seeding reference rows on a server still succeeds; this
 * assertion is the invariant underneath that politeness — no caller who forgets to ask can
 * mint an account whose password is in a public file.
 */
export async function seedDemoAccounts(
  prisma: PrismaClient,
  hasher: PasswordHasher,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Promise<number> {
  assertDemoSeedAllowed(nodeEnv);

  const active = await prisma.lkpValue.findFirstOrThrow({
    where: { code: ACCOUNT_STATUS_CODES.ACTIVE, type: { code: LKP_TYPE_CODES.ACCOUNT_STATUS } },
  });

  let created = 0;
  for (const account of DEMO_ACCOUNTS) {
    if (await prisma.user.findUnique({ where: { email: account.email } })) continue;

    const role = await prisma.lkpValue.findFirstOrThrow({
      where: { code: account.role, type: { code: LKP_TYPE_CODES.USER_ROLE } },
    });
    await prisma.user.create({
      data: {
        email: account.email,
        fullName: account.fullName,
        passwordHash: await hasher.hash(DEMO_PASSWORD),
        roleValueId: role.id,
        statusValueId: active.id,
      },
    });
    created += 1;
  }

  return created;
}
