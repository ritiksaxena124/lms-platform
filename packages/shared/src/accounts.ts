import type { AccountStatusCode, RoleCode } from './lookup-codes';

/**
 * An account as the platform's own operators see it.
 *
 * This is the one read in the system that may name a person by their email address, and the
 * permission is the reason: an operator searching for an account is searching by the address they
 * were given, and the row they land on is the account itself. The ledger made the opposite choice in
 * §18 for a different table — a log row outlives the correction someone makes to their address and
 * the deletion they ask for, so it carries a name and an id and no address. Nothing here copies that
 * record forward either: these are today's columns, read from `users`, and a history of how they got
 * there is `/actions` with the account as its actor or its target.
 *
 * The labels come from the lookup rows rather than from this file. `roleCode` is the word a machine
 * switches on and `roleLabel` is what Ops reads, which is the whole arrangement of the lookup tables:
 * an operator can rename "Operations" to "Support" on a screen and this response follows it without a
 * release.
 */
export interface OpsAccount {
  id: string;
  email: string;
  fullName: string;
  roleCode: RoleCode;
  roleLabel: string;
  statusCode: AccountStatusCode;
  statusLabel: string;
  /** When they last got in, which is the answer to "is this account actually alive" and the reason a
   * disabled one is worth arguing about. */
  lastLoginAt: string | null;
  createdAt: string;
}

/** What an account is holding, read off the rows that point at it.
 *
 * These five numbers are the reason a detail route exists beside the list: an operator about to
 * disable an account is deciding what goes quiet, and a list row cannot carry a count without reading
 * the whole table. `activeSessions` is the number that says how many signed-in devices the status
 * change will refuse on their next request — the refusal is the guard's, not a retirement of the
 * session rows, and the difference is §18's: nothing here deletes anything.
 */
export interface OpsAccountCounts {
  courses: number;
  enrollments: number;
  bookingsAsStudent: number;
  bookingsAsTeacher: number;
  activeSessions: number;
}

export interface OpsAccountDetail extends OpsAccount {
  counts: OpsAccountCounts;
}

/** A page of accounts, newest first. `total` counts everything the filters matched, so a screen can
 * say "412 accounts, these 25" and a search that returns one page can say whether it stopped at the
 * top of the list. */
export interface OpsAccountListResponse {
  items: OpsAccount[];
  page: number;
  pageSize: number;
  total: number;
}

export interface OpsAccountResponse {
  account: OpsAccountDetail;
}
