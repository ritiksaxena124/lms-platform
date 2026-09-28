import { Module } from '@nestjs/common';

import { MailQueue } from './mail-queue.service';

/**
 * The platform's send decisions, filed as news.
 *
 * Two halves live here and they are deliberately not yet joined. `MailQueue` writes an outbox row
 * inside somebody else's transaction — it is the part a booking or an enrollment write calls. The
 * renderer beside it (`render-email`) turns a row and a template into a message, and its caller is
 * the delivery sweep (6e), which has not been built yet; the mail transport from 6a is reached when
 * that sweep exists, not before.
 *
 * So this module is imported by the two modules that notice things happening — bookings and
 * enrollments — and exports only the queue. Neither of them learns anything about SMTP, about copy,
 * or about when the message actually goes; they learn only that a row named `mail_outbox` is
 * standing in for the letter, and that it survives or vanishes with their own write (§6).
 */
@Module({
  providers: [MailQueue],
  exports: [MailQueue],
})
export class NotificationsModule {}
