import { AppLogger } from '../../common/logging/app-logger.service';
import { type Mail, type MailMessage } from './mail.port';

/** What a dropped message may say about itself: that an event happened, and nothing about who was
 * meant to be told. */
export type MailDropLog = (line: { message: string; fields: Record<string, unknown> }) => void;

const logger = new AppLogger();
const logDrop: MailDropLog = (line) => logger.log(line.message, line.fields, 'Mail');

/**
 * A deployment with no mail transport, which is a thing people run rather than a TODO — the same
 * argument the no-video adapter makes (§10). The alternative is an `if` in every place a send
 * decision is made, and those `if`s drift: one path learns to skip the outbox and the next one
 * offers a notification that was never going to exist.
 *
 * It resolves instead of throwing, because a notification is not the reason the request happened.
 * A school running without mail should still be able to book a class; the news of that booking
 * simply stays in the database where the portals can read it.
 *
 * `delivers: false` is what keeps the outbox honest. Without it a sweep would mark each row it
 * dropped as sent, and the one claim nobody can check afterwards — that a person was told — would
 * be recorded as true.
 */
export class NoMail implements Mail {
  readonly delivers = false;

  constructor(private readonly onDrop: MailDropLog = logDrop) {}

  async send(message: MailMessage): Promise<void> {
    this.onDrop({
      message: 'Mail is not configured; the notification was dropped',
      fields: { event: message.event },
    });
  }
}
