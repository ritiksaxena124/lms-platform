import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAIL_OUTBOX_STATUS_CODES, MAIL_SENDING_RECLAIM_MINUTES } from '@lms/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { EmailTemplateCopy } from './render-email';

const MS_PER_MINUTE = 60_000;

/** A claimed row, as the sweep is handed it.
 *
 * The `recipient` is the reason this is a `select` rather than the whole row: the address is read
 * here, at the moment of delivery, and nowhere earlier (6c). Everything else the sweep needs to
 * render and to report is on the row itself. */
const CLAIM_SELECT = {
  id: true,
  eventCode: true,
  payload: true,
  recipientUserId: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  sentAt: true,
  failureReason: true,
  recipient: { select: { email: true } },
} as const satisfies Prisma.MailOutboxSelect;

export type ClaimedMail = Prisma.MailOutboxGetPayload<{ select: typeof CLAIM_SELECT }>;

/** The row as the page is chosen, before anybody owns it. */
const PAGE_SELECT = { id: true } as const satisfies Prisma.MailOutboxSelect;

/**
 * The six writes a delivery sweep makes, and the one read it needs to write a message.
 *
 * No decisions live here. Whether a refused send is worth another ask, how long a row waits for
 * that ask, and when a row stops being asked at all are the sweep's, and they are tested beside a
 * transport; this file is the set of statements those decisions are expressed in. What *is* settled
 * here, once and not again, is that a row is owned by a status write.
 *
 * **The claim is the permission.** `claimDue` moves rows `queued → sending` with `queued` still in
 * the `where`, so a second run — the cron overlapping itself, or two API processes on one database
 * — matches nothing and gets nothing back. There is no lock to expire and no read-then-write window
 * to lose: a student cannot be told the same thing twice by two runners, because only one of them
 * can hold the row. `reclaimAbandoned` is the other half of that, the reason no lock column is
 * needed: a claim is a status, so a process that died mid-send leaves a row that says so, and the
 * next run takes it back once it is older than a run could honestly be.
 *
 * **Terminal writes address a row this run claimed.** `markSent`, `requeue` and `markFailed` all
 * insist on `sending` in their `where` and answer with whether the row was still theirs. A write
 * that returned `void` would let a sweep report a letter as sent on a row another process had
 * already reclaimed and dropped — and a queue that lies about which letters went is worse than no
 * queue, because the sweep would never refile the row.
 *
 * **Nothing here reads or writes an address, a rendered message, or a template's copy into the
 * outbox.** The row is the news; the letter is written at delivery from `findTemplate`, which is
 * why a reword reaches a class that was queued before it.
 */
@Injectable()
export class MailOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Take up to `limit` rows that are due, oldest news first, and say which ones this run now owns.
   *
   * The two statements are not one transaction, and that is deliberate: the page is a hint about
   * what looks due, and the second statement is the only thing that decides anything. A row another
   * runner took between them simply is not in the answer.
   *
   * `createdAt` breaks ties because `next_attempt_at` is not unique in the ordinary case either —
   * several rows filed by one transaction share the same due instant, and a page whose order is
   * decided by the planner is a page that can starve one of them.
   */
  async claimDue(now: Date, limit: number): Promise<ClaimedMail[]> {
    const page = await this.prisma.mailOutbox.findMany({
      where: {
        status: MAIL_OUTBOX_STATUS_CODES.QUEUED,
        nextAttemptAt: { lte: now },
        isActive: true,
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: PAGE_SELECT,
    });
    if (page.length === 0) return [];

    return this.prisma.mailOutbox.updateManyAndReturn({
      where: {
        id: { in: page.map((row) => row.id) },
        status: MAIL_OUTBOX_STATUS_CODES.QUEUED,
      },
      data: { status: MAIL_OUTBOX_STATUS_CODES.SENDING, attempts: { increment: 1 } },
      select: CLAIM_SELECT,
    });
  }

  /** Take back claims whose process is not coming back, without asking what they were doing.
   *
   * The window is `MAIL_SENDING_RECLAIM_MINUTES`, which is wider than a run: a row near the end of
   * a page may still be legitimately in flight, and taking it back would mail a person twice — the
   * one failure this whole design is arranged to make impossible.
   */
  async reclaimAbandoned(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - MAIL_SENDING_RECLAIM_MINUTES * MS_PER_MINUTE);
    const { count } = await this.prisma.mailOutbox.updateMany({
      where: {
        status: MAIL_OUTBOX_STATUS_CODES.SENDING,
        updatedAt: { lt: cutoff },
        isActive: true,
      },
      data: { status: MAIL_OUTBOX_STATUS_CODES.QUEUED },
    });
    return count;
  }

  /** Record that the transport took the message. `at` is the caller's, because it is the date a
   * person asks about and a retry must not move it. */
  async markSent(id: string, at: Date): Promise<boolean> {
    const { count } = await this.prisma.mailOutbox.updateMany({
      where: { id, status: MAIL_OUTBOX_STATUS_CODES.SENDING },
      data: { status: MAIL_OUTBOX_STATUS_CODES.SENT, sentAt: at },
    });
    return count === 1;
  }

  /** Give the row back to the queue with its next ask scheduled and the reason kept beside it.
   *
   * `attempts` is not touched — the claim already counted the ask this row just made, which is what
   * lets the sweep read the retry curve off the number the claim left behind.
   */
  async requeue(id: string, nextAttemptAt: Date, failureReason: string): Promise<boolean> {
    const { count } = await this.prisma.mailOutbox.updateMany({
      where: { id, status: MAIL_OUTBOX_STATUS_CODES.SENDING },
      data: { status: MAIL_OUTBOX_STATUS_CODES.QUEUED, nextAttemptAt, failureReason },
    });
    return count === 1;
  }

  /** Stop asking about this row. The due time stays as the fact it is: a finished row says it is
   * finished in `status`, and the last time it was due is not something ending it should erase. */
  async markFailed(id: string, failureReason: string): Promise<boolean> {
    const { count } = await this.prisma.mailOutbox.updateMany({
      where: { id, status: MAIL_OUTBOX_STATUS_CODES.SENDING },
      data: { status: MAIL_OUTBOX_STATUS_CODES.FAILED, failureReason },
    });
    return count === 1;
  }

  /** Throw away the due rows, on a box with no transport to ask.
   *
   * `attempts` stays at 0 and no reason is written: nothing was asked and nothing refused. The
   * status is the whole report, and a row that claimed to have failed a send that never happened
   * would be the queue lying about the deployment it is standing in.
   */
  async dropDue(now: Date, limit: number): Promise<number> {
    const page = await this.prisma.mailOutbox.findMany({
      where: {
        status: MAIL_OUTBOX_STATUS_CODES.QUEUED,
        nextAttemptAt: { lte: now },
        isActive: true,
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: PAGE_SELECT,
    });
    if (page.length === 0) return 0;

    const { count } = await this.prisma.mailOutbox.updateMany({
      where: {
        id: { in: page.map((row) => row.id) },
        status: MAIL_OUTBOX_STATUS_CODES.QUEUED,
      },
      data: { status: MAIL_OUTBOX_STATUS_CODES.DROPPED },
    });
    return count;
  }

  /** The standing copy for an event, or nothing.
   *
   * `null` covers both an event with no row and a row an operator deactivated, and the sweep treats
   * them the same way: the letter cannot be written, and neither is a database fault worth another
   * ask about. Reading it here rather than joining it into the claim is what keeps the copy
   * rewordable while a queue is standing.
   */
  async findTemplate(eventCode: string): Promise<EmailTemplateCopy | null> {
    return this.prisma.emailTemplate.findFirst({
      where: { eventCode, isActive: true },
      select: { subject: true, heading: true, bodyLines: true, ctaLabel: true },
    });
  }
}
