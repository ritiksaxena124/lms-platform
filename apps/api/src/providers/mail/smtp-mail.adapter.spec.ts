import { describe, expect, it, vi } from 'vitest';

import { SmtpMail } from './smtp-mail.adapter';
import { MailDeliveryError, type MailMessage, UnsafeMailMessageError } from './mail.port';

const URL = 'smtp://user:pass@mail.internal.example:587';
const FROM = 'Hourloom <no-reply@localtest.me>';

const message: MailMessage = {
  event: 'booking_requested',
  to: 'teacher@example.com',
  subject: 'A minute has been asked for',
  text: 'Someone wants a class.',
  html: '<p>Someone wants a class.</p>',
};

/** The transport, doubled. The port's job is the shape of the call; whether a real server accepts
 * it is 6f's question, asked against Ethereal rather than guessed at here. */
function transport(options: { rejects?: unknown } = {}) {
  return {
    sendMail: vi
      .fn()
      .mockImplementation(() =>
        options.rejects
          ? Promise.reject(options.rejects)
          : Promise.resolve({ messageId: '<abc@mail.internal.example>' }),
      ),
  };
}

/** The error a send is expected to reject with — the outbox reads exactly one field off it, so
 * that is what these tests ask for. */
async function rejectedSend(mail: SmtpMail): Promise<MailDeliveryError> {
  try {
    await mail.send(message);
  } catch (error) {
    return error as MailDeliveryError;
  }
  throw new Error('the send was expected to reject');
}

describe('smtp mail adapter', () => {
  it('passes one message to the transport, from the configured sender to the one recipient', async () => {
    const fake = transport();

    await new SmtpMail(URL, FROM, fake).send(message);

    expect(fake.sendMail).toHaveBeenCalledTimes(1);
    expect(fake.sendMail).toHaveBeenCalledWith({
      from: FROM,
      to: 'teacher@example.com',
      subject: 'A minute has been asked for',
      text: 'Someone wants a class.',
      html: '<p>Someone wants a class.</p>',
    });
  });

  it('says it delivers, so the outbox may treat a resolved send as sent', () => {
    expect(new SmtpMail(URL, FROM, transport()).delivers).toBe(true);
  });

  it('refuses a recipient or subject carrying a line break, and does not reach the transport', async () => {
    const fake = transport();
    const mail = new SmtpMail(URL, FROM, fake);

    // This is header injection: a value with a newline in it writes more headers into the message
    // than the two this platform intends. The address comes from a registration form and the
    // subject from a database row an operator edits, so both are values a person typed.
    await expect(
      mail.send({ ...message, to: 'a@example.com\r\nBcc: everyone@example.com' }),
    ).rejects.toThrow(/header/i);
    await expect(
      mail.send({ ...message, subject: 'Class\r\nAttachment: invoice.pdf' }),
    ).rejects.toThrow(/header/i);
    expect(fake.sendMail).not.toHaveBeenCalled();
  });

  it('refuses a recipient list dressed up as one address, because the port reaches one person', async () => {
    const fake = transport();
    const mail = new SmtpMail(URL, FROM, fake);

    // Nodemailer reads a comma or a semicolon in a `To` value as a list, so this is the one shape
    // of the field that changes who gets the message. The address on a user row is checked at
    // registration already; this is the port refusing to be the second door.
    await expect(
      mail.send({ ...message, to: 'a@example.com, everyone@example.com' }),
    ).rejects.toBeInstanceOf(UnsafeMailMessageError);
    expect(fake.sendMail).not.toHaveBeenCalled();
  });

  it('surfaces a rejected send as an error the outbox can retry, naming the transport code', async () => {
    const rejected = Object.assign(new Error('Invalid login'), { code: 'EAUTH', response: '535' });

    const error = await rejectedSend(new SmtpMail(URL, FROM, transport({ rejects: rejected })));

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(error.reason).toBe('EAUTH');
  });

  it('falls back to the SMTP reply code when the transport gives no error code', async () => {
    const rejected = Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 });

    const error = await rejectedSend(new SmtpMail(URL, FROM, transport({ rejects: rejected })));

    expect(error.reason).toBe('smtp 550');
  });

  it('keeps the transport error text out of what the outbox would store', async () => {
    // Nodemailer's message names the host and, on an auth failure, quotes the login it was given
    // — and `failureReason` is a column somebody reads in an admin screen six months from now.
    const rejected = new Error('connect ECONNREFUSED user:pass@mail.internal.example:587');

    const error = await rejectedSend(new SmtpMail(URL, FROM, transport({ rejects: rejected })));

    expect(error.reason).not.toContain('mail.internal.example');
    expect(error.reason).not.toContain('pass');
    expect(error.message).not.toContain('mail.internal.example');
  });

  it('gives a reason even for an error with no code on it', async () => {
    const error = await rejectedSend(
      new SmtpMail(URL, FROM, transport({ rejects: new Error('reset') })),
    );

    expect(error.reason).toBeTruthy();
    expect(error.reason).not.toContain('mail.internal.example');
  });

  it('refuses a URL that is not an SMTP endpoint, at the moment the adapter is built', () => {
    expect(() => new SmtpMail('http://mail.internal.example', FROM, transport())).toThrow(
      /SMTP_URL/,
    );
  });

  it('refuses a sender address that cannot be a From header, at the moment the adapter is built', () => {
    expect(
      () => new SmtpMail(URL, 'no-reply@localtest.me\r\nBcc: all@example.com', transport()),
    ).toThrow(/MAIL_FROM/);
  });
});
