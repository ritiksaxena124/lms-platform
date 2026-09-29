import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The row with the account it is addressed to, and one column less about that account.
 *
 * The include graph is the whole security property of this read, which is why it is spelled out here
 * rather than at the call site that first wanted a name: `users` holds an email address, and the
 * queue's answer to "who is this for" is a name and an id. That is the same promise `recipientUserId`
 * makes in the schema — the table holds no address so that a copy of one cannot outlive the person's
 * correction to it — and a reader that resolved the id back into an address on the way out would have
 * undone it. The delivery sweep *does* read the address, in `CLAIM_SELECT` two files away, because
 * that is the one moment it is needed and the one place it is allowed.
 *
 * `payload` is absent for the same kind of reason: this is a `select`, so the column cannot arrive by
 * being forgotten about, and the answers a template was given are not facts about whether a message
 * went out.
 */
const WITH_RECIPIENT = {
  recipient: { select: { id: true, fullName: true } },
} as const satisfies Prisma.MailOutboxInclude;

export type OutboxRow = Prisma.MailOutboxGetPayload<{ include: typeof WITH_RECIPIENT }>;

/** The question, with the query string already turned into values. */
export interface OutboxFilter {
  status?: string;
  recipientUserId?: string;
}

/**
 * Reading the queue.
 *
 * The sweep's repository writes rows and decides nothing; this reads them and decides nothing either.
 * The split is the action-log one, and for the same reason — a repository with a `find` on it is a
 * repository somebody will start reading through, and the file the claim lives in should not also be
 * the file a route can ask for a page of `sending` rows.
 *
 * Two indexes serve the two questions here. `ix_mail_outbox_due (status, next_attempt_at)` is the
 * sweep's and covers a status-only read; the recipient filter is the question this table could not
 * answer without the pair below it, which is what that index is for.
 */
@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page, newest first, and the count of everything the same filters matched.
   *
   * `id` breaks a tie because `created_at` cannot: several rows filed by one transaction carry the
   * same instant by design, and an ordering that is not total can hand the same row to two pages.
   */
  async page(
    filter: OutboxFilter,
    skip: number,
    take: number,
  ): Promise<{ rows: OutboxRow[]; total: number }> {
    const where = whereFor(filter);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.mailOutbox.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: WITH_RECIPIENT,
      }),
      this.prisma.mailOutbox.count({ where }),
    ]);
    return { rows, total };
  }
}

function whereFor(filter: OutboxFilter): Prisma.MailOutboxWhereInput {
  const where: Prisma.MailOutboxWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.recipientUserId) where.recipientUserId = filter.recipientUserId;
  return where;
}
