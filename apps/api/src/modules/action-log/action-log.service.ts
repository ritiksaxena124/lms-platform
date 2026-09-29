import { Injectable } from '@nestjs/common';
import type {
  ActionActorKindCode,
  ActionCode,
  ActionDetail,
  ActionListResponse,
  ActionLogEntry,
  ActionSectionCode,
  ActionTargetTableCode,
} from '@lms/shared';

import { ActionLogRepository, type ActionLogRow } from './action-log.repository';
import type { ListActionsQueryDto } from './dto/list-actions-query.dto';

/** The same twenty-five the roster draws, because the number is a screen's, not a table's. */
const DEFAULT_PAGE_SIZE = 25;

/**
 * The ledger, answered in the vocabulary rather than in columns.
 *
 * This is the one place the read side meets `@lms/shared`, and it deliberately does not check the
 * codes it hands back. `actionShapeFor` throws, which is right for a writer — a row filed under an
 * action nobody declared is a bug to be shouted about — and wrong for a reader: a log that refuses to
 * answer because one row holds a string no longer in the list would hide the rest of the history
 * behind it. The columns are text, the table believes whatever wrote them, and the honest reading of
 * an unfamiliar code is the code itself.
 */
@Injectable()
export class ActionLogService {
  constructor(private readonly ledger: ActionLogRepository) {}

  async list(query: ListActionsQueryDto): Promise<ActionListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const { rows, total } = await this.ledger.page(
      {
        section: query.section,
        action: query.action,
        actorUserId: query.actor,
        targetTable: query.targetTable,
        targetId: query.targetId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      (page - 1) * pageSize,
      pageSize,
    );

    return { items: rows.map(toEntry), page, pageSize, total };
  }
}

function toEntry(row: ActionLogRow): ActionLogEntry {
  return {
    id: row.id,
    actionCode: row.actionCode as ActionCode,
    sectionCode: row.sectionCode as ActionSectionCode,
    actorKind: row.actorKind as ActionActorKindCode,
    targetTable: row.targetTable as ActionTargetTableCode,
    // Not resolved to anything, and never asked to be: the record outlives the row it is about, so a
    // retired course still has a history and this route does not pretend otherwise.
    targetId: row.targetId,
    detail: row.detail as ActionDetail,
    actor: row.actor
      ? { id: row.actor.id, fullName: row.actor.fullName, roleCode: row.actorRoleCode }
      : null,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}
