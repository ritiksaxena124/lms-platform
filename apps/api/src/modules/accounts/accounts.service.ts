import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTION_CODES,
  API_ERROR_CODES,
  type AccountStatusCode,
  LKP_TYPE_CODES,
  type OpsAccount,
  type OpsAccountDetail,
  type OpsAccountListResponse,
  ROLE_CODES,
  type RoleCode,
} from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import { ActionRecorder } from '../action-log/action-recorder';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { AccountsRepository, type AccountRow } from './accounts.repository';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';

/** The same twenty-five every other list screen draws. */
const DEFAULT_PAGE_SIZE = 25;

/** A row is addressed by its id and nothing else, which is the whole reason a malformed id can be
 * answered with a 404 rather than a cast error from the driver. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The accounts screen, and the two decisions it is allowed to make.
 *
 * **Every read here is a row of `users` as it stands.** The history of how an account got to its
 * role or its status is the ledger's, reached by `/actions?actor=` or `?targetTable=users&targetId=`;
 * this service answers "what is true now" and never pretends to answer "what happened".
 *
 * **An operator cannot move their own account.** Not its status and not its role: the first refusal
 * is the platform losing its way back in, and the second is one click from an empty room. The rule
 * is stated as one thing on purpose — it is the same rule arrived at from the same chair, and an
 * exception granted for one of the two writes would be a way to reach the other.
 *
 * **The pair of writes is the reason `ops` exists as a role at all.** Phase 7 built a ledger and
 * guarded it by a role nothing could issue; these two routes are what makes issuing it a thing a
 * person does rather than a thing a deploy script does. Everything else on this surface is a read.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly reference: ReferenceService,
    private readonly actions: ActionRecorder,
  ) {}

  async list(query: ListUsersQueryDto): Promise<OpsAccountListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const { rows, total } = await this.accounts.page(
      { search: query.q, role: query.role, status: query.status },
      (page - 1) * pageSize,
      pageSize,
    );

    return { items: rows.map(toAccount), page, pageSize, total };
  }

  async read(id: string): Promise<OpsAccountDetail> {
    const account = await this.require(id);
    return toDetail(account, await this.accounts.counts(account.id));
  }

  /** Disable an account, or give it back.
   *
   * One column moves. The sessions are left where they are because `JwtAuthGuard` asks the account
   * on every request and `/auth/refresh` asks it too, so an account that goes dark is refused inside
   * one request of being switched off — and switching it back on has nothing to undo. Retiring token
   * rows here would be a second, louder way of saying the same thing, and a disabled account that
   * then comes back would have lost sessions it never needed to lose.
   */
  async changeStatus(
    actor: AuthenticatedUser,
    id: string,
    status: AccountStatusCode,
  ): Promise<OpsAccountDetail> {
    if (actor.id === id) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'You cannot change the status of your own account.',
      });
    }

    const account = await this.require(id);
    if (account.status.code === status) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'This account already has that status.',
      });
    }

    const target = await this.lookup(LKP_TYPE_CODES.ACCOUNT_STATUS, status);
    const written = await this.accounts.updateStatusValue(account.id, target.id, (tx) =>
      this.actions.record(tx, {
        action: ACTION_CODES.ACCOUNT_STATUS_CHANGED,
        targetId: account.id,
        detail: { from: account.status.code, to: status },
      }),
    );

    return toDetail(written, await this.accounts.counts(written.id));
  }

  /** Issue or revoke the ops role, which is the only role move this route makes.
   *
   * A student becoming a teacher is not a platform decision anybody has built a screen for yet: this
   * account was either registered by itself or issued the ops role, and the two are the only
   * transitions the product has an opinion about. Refusing the third rather than quietly allowing it
   * keeps the route to the promise Phase 8 made, and the day a moderation flow exists, the check is
   * the thing that gets removed.
   *
   * Revocation lands the account on a portal rather than on nothing, which is why the body carries a
   * role instead of a `revoke` flag: an account with no role could not open either app, and a route
   * that invented one for it would be guessing at the person's own history.
   */
  async changeRole(
    actor: AuthenticatedUser,
    id: string,
    role: RoleCode,
  ): Promise<OpsAccountDetail> {
    if (actor.id === id) {
      throw new ForbiddenException({
        code: API_ERROR_CODES.FORBIDDEN,
        message: 'You cannot change the role of your own account.',
      });
    }

    const account = await this.require(id);
    if (account.role.code === role) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'This account already has that role.',
      });
    }

    if (account.role.code !== ROLE_CODES.OPS && role !== ROLE_CODES.OPS) {
      throw new ConflictException({
        code: API_ERROR_CODES.CONFLICT,
        message: 'Only the ops role is issued or revoked here.',
      });
    }

    const target = await this.lookup(LKP_TYPE_CODES.USER_ROLE, role);
    const written = await this.accounts.updateRoleValue(account.id, target.id, (tx) =>
      this.actions.record(tx, {
        action: ACTION_CODES.ACCOUNT_ROLE_CHANGED,
        targetId: account.id,
        detail: { from: account.role.code, to: role },
      }),
    );

    return toDetail(written, await this.accounts.counts(written.id));
  }

  /** The account, or the answer this surface gives to an id that is not one — including an id that
   * could not have been one, which is not a different question to an operator. */
  private async require(id: string): Promise<AccountRow> {
    const account = UUID.test(id) ? await this.accounts.findById(id) : null;
    if (!account) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'No account with that id.',
      });
    }
    return account;
  }

  private async lookup(
    typeCode: (typeof LKP_TYPE_CODES)[keyof typeof LKP_TYPE_CODES],
    code: string,
  ) {
    const [value] = await this.reference.valuesByCodes(typeCode, [code]);
    if (!value) {
      throw new Error(`Reference value ${typeCode}/${code} is not seeded`);
    }
    return value;
  }
}

function toAccount(row: AccountRow): OpsAccount {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    roleCode: row.role.code as RoleCode,
    roleLabel: row.role.label,
    statusCode: row.status.code as AccountStatusCode,
    statusLabel: row.status.label,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: AccountRow, counts: OpsAccountDetail['counts']): OpsAccountDetail {
  return { ...toAccount(row), counts };
}
