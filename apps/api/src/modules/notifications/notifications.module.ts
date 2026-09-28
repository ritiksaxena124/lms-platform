import { Module } from '@nestjs/common';

import { MailModule } from '../../providers/mail/mail.module';
import { MailDeliveryService } from './mail-delivery.service';
import { MailQueue } from './mail-queue.service';
import { MailOutboxRepository } from './mail-outbox.repository';

/**
 * The platform's send decisions, filed as news, and the sweep that sends them.
 *
 * Three parts, and the split between them is the design: `MailQueue` writes an outbox row inside
 * somebody else's transaction — it is the half a booking or an enrollment write calls.
 * `MailOutboxRepository` is the set of writes the delivery run is made of: the claim that decides
 * which rows a run owns, and the terminal writes that record what happened to each one.
 * `MailDeliveryService` is the run itself, and it is the only thing in the platform that reaches
 * 6a's transport, which is why this is where `MailModule` is imported.
 *
 * So the sweep knows the queue only as rows, and the senders know it only as a row. Neither of them
 * learns anything about SMTP from the other: bookings and enrollments import the queue, and nobody
 * outside this module asks for the repository or the service — the cron is the only caller the
 * sweep needs (§6).
 */
@Module({
  imports: [MailModule],
  providers: [MailQueue, MailOutboxRepository, MailDeliveryService],
  exports: [MailQueue],
})
export class NotificationsModule {}
