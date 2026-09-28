import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { MAIL_DELIVERY_BATCH_SIZE, mailRetryDelayMinutes } from '@lms/shared';

import { AppLogger } from '../../common/logging/app-logger.service';
import {
  MAIL,
  MailDeliveryError,
  type Mail,
  type MailMessage,
  UnsafeMailMessageError,
} from '../../providers/mail/mail.port';
import type { MailEnvelope } from './mail-queue.service';
import { MailOutboxRepository, type ClaimedMail } from './mail-outbox.repository';
import {
  renderEmail,
  UnfilledEmailSlotError,
  UnsafeEmailLinkError,
  UnusableEmailTemplateError,
} from './render-email';

const MS_PER_MINUTE = 60_000;

/** What one run did, stated in the five states a row can be left in.
 *
 * Not a count of rows touched, because the four numbers mean different things to different
 * questions: `sent` is what a person was told, `retried` is what is still waiting, `failed` is what
 * nobody will ever be told about, and `dropped` is what this deployment threw away. `released` and
 * `unresolved` are the two ways a row escapes this run's hands — taken back by another process, or
 * left standing on a surprise this file has no case for — and both mean the news is still queued.
 */
export interface MailDeliveryReport {
  reclaimed: number;
  sent: number;
  retried: number;
  failed: number;
  dropped: number;
  released: number;
  unresolved: number;
}

/** The row's payload is not the envelope 6d files. A table a report can join is a table somebody
 * can write into by hand, and the sweep's answer is to refuse the row rather than crash the run. */
export class UnreadableMailPayloadError extends Error {
  constructor() {
    super('The payload on this row is not an envelope of slots and a destination');
    this.name = 'UnreadableMailPayloadError';
  }
}

/** The refusals that are about the *letter* rather than the mail host: asking again gets the same
 * answer, because the copy, the payload or the address has not changed between runs. */
const UNWRITABLE = [
  UnusableEmailTemplateError,
  UnfilledEmailSlotError,
  UnsafeEmailLinkError,
  UnsafeMailMessageError,
  UnreadableMailPayloadError,
] as const;

function isUnwritable(error: unknown): boolean {
  return UNWRITABLE.some((kind) => error instanceof kind);
}

function envelopeOf(payload: Prisma.JsonValue): MailEnvelope {
  const value = payload as { slots?: unknown; href?: unknown } | null;
  if (
    !value ||
    typeof value.href !== 'string' ||
    typeof value.slots !== 'object' ||
    value.slots === null ||
    Array.isArray(value.slots)
  ) {
    throw new UnreadableMailPayloadError();
  }
  return { slots: value.slots as Record<string, string>, href: value.href };
}

/**
 * Sends what the queue was told, on the wall clock.
 *
 * The sweep is the only place in Phase 6 that reaches a mail transport, and it is deliberately the
 * dumbest part of the design: it takes the rows that are due, writes each one's letter from the
 * standing copy, hands the message to the port and records which of the five states the row is now
 * in. All the interesting decisions were made earlier — in 6c's columns, in 6d's transactions, and
 * in the retry curve next to the queue's own numbers.
 *
 * **A row is asked about once per run.** The claim counted the ask before the transport was touched,
 * which is what lets `mailRetryDelayMinutes` read the wait off the row it is holding, and why two
 * overlapping runs cannot both mail the same news (the claim itself says `queued`, and a row that is
 * `sending` belongs to whoever put it there).
 *
 * **Only a transport's refusal is retried.** `MailDeliveryError` carries 6a's sanitised code, and it
 * is the one failure whose next attempt could answer differently — a host that is unreachable now
 * may not be in five minutes. Everything the renderer or the address book refused ends the row: the
 * copy has not changed between runs, and a queue that retries a broken sentence keeps a person from
 * ever being told while filling the log with the same error.
 *
 * **A surprise is not a row's fault.** An error this file has no case for — an outage in the middle
 * of reading a template, a bug — leaves the row in `sending` and the run carries on with the rest of
 * the page. The reclaim takes it back once it is older than a run could honestly be, so the news
 * waits for the bug to be fixed rather than being written off as though the recipient had done
 * something. Logging the event code and the row id says which one, and never the address: a log file
 * is shipped and grepped by people who have no business reading a student's email out of it (§6).
 *
 * **The cadence is the queue's, not this file's.** `MAIL_SWEEP_INTERVAL_MINUTES` and
 * `MAIL_DELIVERY_BATCH_SIZE` come from `@lms/shared` beside the retry curve, so the answer to "how
 * long until my confirmation arrives" is in one place, and a change to it changes the tests that
 * quote the number.
 */
@Injectable()
export class MailDeliveryService {
  private readonly logger = new AppLogger();

  constructor(
    private readonly outbox: MailOutboxRepository,
    @Inject(MAIL) private readonly mail: Mail,
  ) {}

  /** Every five minutes, on the box's own clock.
   *
   * Named so an operator can find it: `mail-outbox-delivery` is what they stop, restart or grep for,
   * rather than a generated uuid in a scheduler listing.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'mail-outbox-delivery' })
  async deliverOnSchedule(): Promise<void> {
    await this.run(new Date());
  }

  /** Run the sweep as of `now`, over at most `limit` due rows.
   *
   * Both are arguments because both are questions a test asks: the retry curve is a question about
   * time, and the page is a question about how much of a backlog one run takes. Production reaches
   * this through the cron with the batch the queue was sized for.
   */
  async run(now: Date, limit: number = MAIL_DELIVERY_BATCH_SIZE): Promise<MailDeliveryReport> {
    const report: MailDeliveryReport = {
      reclaimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      dropped: 0,
      released: 0,
      unresolved: 0,
    };

    // A deployment that has not decided on mail does not get to pretend it did: the news is thrown
    // away in the open, with no ask counted and no reason invented for it.
    if (!this.mail.delivers) {
      report.dropped = await this.outbox.dropDue(now, limit);
      if (report.dropped > 0) {
        this.logger.log(
          `Dropped ${report.dropped} queued notification(s): this box has no mail transport`,
          'MailDelivery',
        );
      }
      return report;
    }

    // Before taking anything new: a claim whose process died is otherwise a row nobody sends and
    // nobody retries, and it is older than the rows this run is about to pick up.
    report.reclaimed = await this.outbox.reclaimAbandoned(now);

    const claimed = await this.outbox.claimDue(now, limit);
    for (const row of claimed) {
      await this.deliver(row, now, report);
    }

    if (claimed.length > 0) {
      this.logger.log(
        `Mail sweep: ${report.sent} sent, ${report.retried} waiting, ${report.failed} ended`,
        'MailDelivery',
        { reclaimed: report.reclaimed, released: report.released, unresolved: report.unresolved },
      );
    }
    return report;
  }

  /** One row, one ask, one write. */
  private async deliver(row: ClaimedMail, now: Date, report: MailDeliveryReport): Promise<void> {
    try {
      await this.mail.send(await this.compose(row));
      await this.settle(row, this.outbox.markSent(row.id, now), 'sent', report);
    } catch (error) {
      if (error instanceof MailDeliveryError) {
        await this.refused(row, error, now, report);
        return;
      }
      if (isUnwritable(error)) {
        await this.settle(
          row,
          this.outbox.markFailed(row.id, (error as Error).message),
          'failed',
          report,
        );
        this.logger.warn('A queued notification cannot be written', 'MailDelivery', {
          event: row.eventCode,
          id: row.id,
          reason: (error as Error).message,
        });
        return;
      }
      // Nothing was written and nothing was decided: the row keeps its claim, and the reclaim is
      // what will bring it back. The page carries on — one row's surprise is not a reason to leave
      // twenty-four people unread.
      report.unresolved += 1;
      this.logger.error('Mail delivery stopped on a row it could not explain', 'MailDelivery', {
        event: row.eventCode,
        id: row.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** The transport said no, which is the one answer worth asking about again — unless the curve says
   * there is no ask left in the row. */
  private async refused(
    row: ClaimedMail,
    error: MailDeliveryError,
    now: Date,
    report: MailDeliveryReport,
  ): Promise<void> {
    const delay = mailRetryDelayMinutes(row.attempts);
    if (delay === null) {
      await this.settle(row, this.outbox.markFailed(row.id, error.reason), 'failed', report);
      this.logger.warn('A queued notification ran out of retries', 'MailDelivery', {
        event: row.eventCode,
        id: row.id,
        attempts: row.attempts,
        reason: error.reason,
      });
      return;
    }
    await this.settle(
      row,
      this.outbox.requeue(row.id, new Date(now.getTime() + delay * MS_PER_MINUTE), error.reason),
      'retried',
      report,
    );
  }

  /** The row is written as this run's answer, if it is still this run's row. */
  private async settle(
    row: ClaimedMail,
    write: Promise<boolean>,
    outcome: 'sent' | 'retried' | 'failed',
    report: MailDeliveryReport,
  ): Promise<void> {
    if (await write) {
      report[outcome] += 1;
      return;
    }
    // Somebody else owns it now. Report it as nothing: a row this run did not finish is a row that
    // will be asked about again, which is the honest half of the count.
    report.released += 1;
    this.logger.warn('A queued notification was taken back mid-send', 'MailDelivery', {
      event: row.eventCode,
      id: row.id,
    });
  }

  /** The letter, written at delivery from the row's news and the copy that stands today.
   *
   * The action is passed only when the copy asks for a button, because the renderer refuses either
   * half alone — a label with nowhere to go, or a destination with no words on it. Which means an
   * operator who clears a `cta_label` turns that event into a notice, and the row's own `href`
   * simply goes unused.
   */
  private async compose(row: ClaimedMail): Promise<MailMessage> {
    const template = await this.outbox.findTemplate(row.eventCode);
    if (!template) {
      // Not a database error and not a retry: an event nobody filed copy for. The row says so, and
      // a person filing the copy later is the only fix — of a queued row, not of a letter.
      throw new UnusableEmailTemplateError(`no standing copy files the event ${row.eventCode}`);
    }
    const envelope = envelopeOf(row.payload);
    const rendered = renderEmail({
      template,
      payload: envelope.slots,
      action: template.ctaLabel ? { href: envelope.href } : undefined,
    });
    return { event: row.eventCode, to: row.recipient.email, ...rendered };
  }
}
