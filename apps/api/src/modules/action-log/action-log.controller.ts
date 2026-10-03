import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSION_CODES, type ActionListResponse } from '@lms/shared';

import { Permissions } from '../auth/permissions.decorator';
import { ActionLogService } from './action-log.service';
// Value import: the validation pipe finds a DTO through emitted parameter metadata, and an
// erased class would leave every query unchecked.
import { ListActionsQueryDto } from './dto/list-actions-query.dto';

/**
 * The only door into the ledger, and it is guarded by role rather than by relationship.
 *
 * A teacher may read their own courses and a student their own places, because those rows are about
 * the thing that is theirs. This table is not: one page of it holds one account's sign-ins next to
 * another teacher's decisions, and no filter makes a stranger's history readable by narrowing it.
 * So the answer to "who may ask" is ops, and the answer to "what may be asked" is the filters —
 * which is why there is no `@OptionalSession()` read here and no self-service route beside it. An
 * account reading its own record is a real question, and it is a different permission, so it is not
 * smuggled in as a special case of this one.
 *
 * Read-only by construction: this module writes through `ActionRecorder` and nothing else, and a
 * route that could file its own rows would be a ledger that answers to whoever asks.
 */
@Controller('actions')
@Permissions(PERMISSION_CODES.ACTIVITY_READ)
export class ActionLogController {
  constructor(private readonly actions: ActionLogService) {}

  @Get()
  list(@Query() query: ListActionsQueryDto): Promise<ActionListResponse> {
    return this.actions.list(query);
  }
}
