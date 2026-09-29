import { Controller, Get, Query } from '@nestjs/common';
import { ROLE_CODES, type OutboxListResponse } from '@lms/shared';

import { Roles } from '../auth/roles.decorator';
// Value import: the validation pipe finds a DTO through emitted parameter metadata, and an
// erased class would leave every query unchecked.
import { ListOutboxQueryDto } from './dto/list-outbox-query.dto';
import { OutboxService } from './outbox.service';

/**
 * The only door into the queue, and it is the queue rather than the post.
 *
 * Ops-gated for the same reason the ledger is: one page of `mail_outbox` holds one student's
 * enrolments next to another teacher's class requests, and no filter makes a stranger's news
 * readable by narrowing it. Teachers and students get their own lists from the features that made
 * the news in the first place, where the question is already "mine".
 *
 * Read-only, and list-only. There is no detail route because a row has nothing behind it that this
 * table can show — the letter is rendered at delivery from a template an operator may have reworded
 * since, so anything this route could say about the words is a guess — and no write because retrying
 * a row by hand would be a second process making the sweep's promises about claims, attempts and
 * how many times a person gets told the same thing.
 */
@Controller('outbox')
@Roles(ROLE_CODES.OPS)
export class OutboxController {
  constructor(private readonly queue: OutboxService) {}

  @Get()
  list(@Query() query: ListOutboxQueryDto): Promise<OutboxListResponse> {
    return this.queue.list(query);
  }
}
