import { Injectable } from '@nestjs/common';
import {
  mailEventLabel,
  mailOutboxStatusLabel,
  type MailEventCode,
  type MailOutboxStatusCode,
  type OutboxEntry,
  type OutboxListResponse,
} from '@lms/shared';

import { OutboxRepository, type OutboxRow } from './outbox.repository';
import type { ListOutboxQueryDto } from './dto/list-outbox-query.dto';

/** The same twenty-five the ledger and the roster draw, because the number is a screen's. */
const DEFAULT_PAGE_SIZE = 25;

/**
 * The queue, answered in the vocabulary rather than in columns.
 *
 * Like the ledger's read side, this does not check the codes it hands back: `event_code` and `status`
 * are text and the table believes whatever wrote them, so an unfamiliar one comes back as itself with
 * its label falling through to the same string. Refusing a whole page over one hand-inserted row
 * would hide the queue behind it, which is the opposite of what a screen standing over a queue is for.
 *
 * Nothing here decides what a status means either. Which states a row moves between, how many times
 * it is asked and when it stops being asked are the sweep's; this file reports the columns it is left
 * with, including `attempts`, so an operator can see a row that has run out of curve without having
 * to reconstruct the retry list from `@lms/shared`.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly queue: OutboxRepository) {}

  async list(query: ListOutboxQueryDto): Promise<OutboxListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const { rows, total } = await this.queue.page(
      { status: query.status, recipientUserId: query.recipient },
      (page - 1) * pageSize,
      pageSize,
    );

    return { items: rows.map(toEntry), page, pageSize, total };
  }
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    eventCode: row.eventCode as MailEventCode,
    eventLabel: mailEventLabel(row.eventCode),
    status: row.status as MailOutboxStatusCode,
    statusLabel: mailOutboxStatusLabel(row.status),
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    // Null until the transport takes it, and null afterwards on a row that never went — which is the
    // difference between this column and `status` saying no.
    sentAt: row.sentAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    // A row always has one: `recipient_user_id` is not nullable and the account behind it cannot be
    // deleted while a letter is addressed to it.
    recipient: { id: row.recipient.id, fullName: row.recipient.fullName },
    createdAt: row.createdAt.toISOString(),
  };
}
