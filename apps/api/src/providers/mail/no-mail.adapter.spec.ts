import { describe, expect, it } from 'vitest';

import { NoMail } from './no-mail.adapter';
import type { MailMessage } from './mail.port';

const message: MailMessage = {
  event: 'booking_requested',
  to: 'teacher@example.com',
  subject: 'A minute has been asked for',
  text: 'Someone wants a class.',
  html: '<p>Someone wants a class.</p>',
};

/**
 * A deployment with no mail transport, which is a thing people run rather than a TODO — the same
 * argument the no-video adapter makes (§10). The alternative is an `if (mailer === 'none')` in
 * every place a send decision is made, and those `if`s drift: one path learns to skip the outbox
 * and the next one does not.
 */
describe('no-mail adapter', () => {
  it('resolves rather than throwing, so an unconfigured box does not fail the request that made a notification', async () => {
    const mail = new NoMail(() => {});

    await expect(mail.send(message)).resolves.toBeUndefined();
  });

  it('says it delivers nothing, so the outbox never records a dropped message as sent', () => {
    expect(new NoMail(() => {}).delivers).toBe(false);
  });

  it('logs the event it dropped, and nothing that identifies the recipient', async () => {
    const dropped: Array<{ message: string; fields: Record<string, unknown> }> = [];
    await new NoMail((line) => dropped.push(line)).send(message);

    expect(dropped).toEqual([
      // Exactly one line, whose fields are exactly the event code — a later `to` or `subject`
      // added to this log would fail here rather than in a compliance review.
      { message: expect.any(String), fields: { event: 'booking_requested' } },
    ]);
    // An address in a log line is a copy of personal data in a file that gets rotated, shipped
    // and grepped, so the only handle a log may carry is the event code — never the recipient,
    // and not the subject either, which names the people involved.
    const logged = JSON.stringify(dropped);
    expect(logged).not.toContain('teacher@example.com');
    expect(logged).not.toContain('A minute has been asked for');
  });
});
