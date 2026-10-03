import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  PERMISSION_CODES,
  type OpsAccountDetail,
  type OpsAccountListResponse,
  type RoleCode,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { AccountsService } from './accounts.service';
// Value imports: the validation pipe finds a DTO through emitted parameter metadata, and an
// erased class would leave every body and query string unchecked.
import { ChangeAccountRoleDto, ChangeAccountStatusDto } from './dto/account-change.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

/**
 * The accounts screen, and the reason the ops role is worth having.
 *
 * Guarded by role rather than by relationship, exactly as the ledger is, and for the same reason in
 * a sharper form: these rows are not about the account asking. A teacher may read their own courses
 * because a course is theirs; nobody's own account list is their account, and there is no filter on
 * this surface that makes another person's row readable by narrowing it.
 *
 * The address is `users` rather than `accounts` because it is the table, and a second name for the
 * same rows in a second URL is how a platform ends up with two doors that do not quite agree. A
 * person reading their own account comes by `/auth/me`, which is a different permission and already
 * exists.
 */
@Controller('users')
@Permissions(PERMISSION_CODES.ACCOUNT_MANAGE)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Query() query: ListUsersQueryDto): Promise<OpsAccountListResponse> {
    return this.accounts.list(query);
  }

  @Get(':id')
  read(@Param('id') id: string): Promise<{ account: OpsAccountDetail }> {
    return this.accounts.read(id).then((account) => ({ account }));
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeAccountStatusDto,
  ): Promise<{ account: OpsAccountDetail }> {
    return this.accounts.changeStatus(actor, id, dto.status).then((account) => ({ account }));
  }

  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeAccountRoleDto,
  ): Promise<{ account: OpsAccountDetail }> {
    return this.accounts
      .changeRole(actor, id, dto.role as RoleCode)
      .then((account) => ({ account }));
  }
}
