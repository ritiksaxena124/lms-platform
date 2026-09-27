import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ROLE_CODES,
  type AvailabilityRuleListResponse,
  type AvailabilityRuleResponse,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AvailabilityService } from './availability.service';
// Value imports: the validation pipe finds a DTO through emitted parameter metadata, and an
// erased class would leave every body unchecked.
import { CreateAvailabilityRuleDto, UpdateAvailabilityRuleDto } from './dto/availability-rule.dto';

/**
 * A teacher's own week: the windows they keep open for classes.
 *
 * The address is not nested under a course, because a window is not part of a course — it is a
 * shape the teacher's week has, from which slots in any of their courses may later be cut. What
 * a window belongs to is the account, and that is the only ownership here: the id in the address
 * is a lookup key, never a permission.
 *
 * `@Roles(TEACHER)` covers all four routes. A student reading a teacher's availability would be
 * reading a schedule they cannot book against — the open slots a student is shown are instants in
 * the future, derived from these rules by the endpoint that answers them, not this list.
 */
@Controller('availability/rules')
@Roles(ROLE_CODES.TEACHER)
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<AvailabilityRuleListResponse> {
    return { items: await this.availability.list(user.id) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAvailabilityRuleDto,
  ): Promise<AvailabilityRuleResponse> {
    return { rule: await this.availability.create(user.id, dto) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAvailabilityRuleDto,
  ): Promise<AvailabilityRuleResponse> {
    return { rule: await this.availability.update(user.id, id, dto) };
  }

  /** Its own endpoint rather than `isActive: false` on the patch, because closing a window is a
   * decision with a state attached to it — one that cannot be smuggled in beside an edit of the
   * hours. */
  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  async retire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AvailabilityRuleResponse> {
    return { rule: await this.availability.retire(user.id, id) };
  }
}
