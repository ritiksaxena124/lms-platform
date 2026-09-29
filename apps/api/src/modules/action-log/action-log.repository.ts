import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The row with the account it credits, and nothing else about that account.
 *
 * The include graph is the whole security property of the read side, so it lives here rather than at
 * the call site that first wanted a name: `users` holds an email address, and the ledger's answer to
 * "who did this" is a name and an id. A route that reached for the actor some other way would be one
 * `include: true` away from putting an address in a log read — the reason `mail_outbox` holds a
 * recipient id instead of an address, met from the other side.
 */
const WITH_ACTOR = {
  actor: { select: { id: true, fullName: true } },
} as const satisfies Prisma.ActionLogInclude;

export type ActionLogRow = Prisma.ActionLogGetPayload<{ include: typeof WITH_ACTOR }>;

/** The question, with the query string already turned into values. Dates are dates here so nothing
 * downstream has to decide what a string meant; the shape was checked at the door. */
export interface ActionLogFilter {
  section?: string;
  action?: string;
  actorUserId?: string;
  targetTable?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Reading the ledger.
 *
 * The recorder writes rows and this reads them, in one module and two files, because the two halves
 * have nothing in common but the table: one is called inside somebody else's transaction and must
 * never be able to reach a client of its own, and the other needs a connection of its own and never
 * writes. Keeping them apart is also what keeps the writer honest — a repository with a `find` on it
 * is a repository somebody will start reading through.
 *
 * Nothing here decides what an action means. `action_code` and `section_code` arrive back as the
 * strings the writer filed, and the service is where they meet `@lms/shared` again.
 */
@Injectable()
export class ActionLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page, newest first, and the count of everything the same filters matched.
   *
   * The two statements go in one transaction array, which is what lets a screen say "of 412
   * sign-ins, these 25" without the total being a slightly different question than the page — a
   * ledger this busy is written while it is being read.
   *
   * `id` breaks a tie because `created_at` cannot: two rows filed by one transaction carry the same
   * instant by design, and an ordering that is not total can hand the same row to two pages.
   */
  async page(
    filter: ActionLogFilter,
    skip: number,
    take: number,
  ): Promise<{ rows: ActionLogRow[]; total: number }> {
    const where = whereFor(filter);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.actionLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: WITH_ACTOR,
      }),
      this.prisma.actionLog.count({ where }),
    ]);
    return { rows, total };
  }
}

function whereFor(filter: ActionLogFilter): Prisma.ActionLogWhereInput {
  const where: Prisma.ActionLogWhereInput = {};
  if (filter.section) where.sectionCode = filter.section;
  if (filter.action) where.actionCode = filter.action;
  if (filter.actorUserId) where.actorUserId = filter.actorUserId;
  if (filter.targetTable) where.targetTable = filter.targetTable;
  if (filter.targetId) where.targetId = filter.targetId;

  // Both ends inclusive: an operator who means "up to midnight" means the last action of the day.
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  return where;
}
