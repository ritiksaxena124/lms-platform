import { Module } from '@nestjs/common';

import { MailQueue } from './mail-queue.service';
import { MailOutboxRepository } from './mail-outbox.repository';

/**
 * The platform's send decisions, filed as news, and the statements that will send them.
 *
 * Three parts live here and the join is still one step away. `MailQueue` writes an outbox row
 * inside somebody else's transaction — it is the part a booking or an enrollment write calls.
 * `render-email` turns a row and a template into a message. `MailOutboxRepository` is the set of
 * writes the delivery sweep (6e) is made of: the claim that decides which rows a run owns, and the
 * terminal writes that record what happened to each one. The sweep itself, and the mail transport
 * from 6a it will call, are the next step — so nothing outside this module asks for the repository
 * yet, which is why it is a provider here and not an export.
 *
 * What the module does export is the queue, because that is the half bookings and enrollments
 * import. Neither of them learns anything about SMTP, about copy, or about when the message
 * actually goes; they learn only that a row named `mail_outbox` is standing in for the letter, and
 * that it survives or vanishes with their own write (§6).
 */
@Module({
  providers: [MailQueue, MailOutboxRepository],
  exports: [MailQueue],
})
export class NotificationsModule {}
