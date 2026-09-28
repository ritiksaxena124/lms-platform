import { createTransport } from 'nodemailer';

import {
  MailDeliveryError,
  type Mail,
  type MailMessage,
  UnsafeMailMessageError,
  UnusableMailConfigError,
} from './mail.port';

/**
 * The transport, in the two words this adapter uses.
 *
 * Nodemailer's own types stay out of the port and out of every caller for the reason §6 gives: a
 * route that can name `SentMessageInfo` is a route that cannot be moved to another vendor without
 * editing it. This shape is also the seam the specs send through — the double here answers the
 * question "what would the vendor be asked to do", and whether a real server accepts it is a
 * different question, asked against Ethereal in 6f.
 */
export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/** A header value is a single line. A CR or an LF in a value that reaches a header ends that line
 * and starts another, which is how `a@example.com` becomes `a@example.com` plus a Bcc to
 * everybody. Bodies may span lines; headers may not. */
const LINE_BREAK = /[\r\n]/;

/** A recipient list in disguise. Nodemailer reads a comma in a `To` value as a list of recipients,
 * so an address that grows one would mail strangers from a row meant to reach one person. */
const NOT_ONE_ADDRESS = /[,;]/;

/** The letters and digits a transport error code is made of. Anything longer or stranger is a
 * message, and a message is what must not be stored. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

/**
 * Mail over SMTP, through nodemailer, with nothing of nodemailer's above the port.
 *
 * The URL is validated here rather than trusted at first use because both directions of getting it
 * wrong are quiet ones: a typo that leaves no credentials in the string still boots, and the first
 * person to discover that nothing is delivered is the teacher waiting for a confirmation. So an
 * unusable endpoint stops the boot, which is where a deployment can still hear it.
 */
export class SmtpMail implements Mail {
  readonly delivers = true;

  private readonly transport: MailTransport;

  constructor(
    url: string,
    private readonly from: string,
    transport?: MailTransport,
  ) {
    // Checked before the transport exists, so an unusable config is refused with this platform's
    // words. Building nodemailer's transport first would answer a typo with one of its own
    // errors, and the operator reading the boot log would have no key name in it.
    if (!isSmtpUrl(url)) {
      throw new UnusableMailConfigError(
        `SMTP_URL must be an smtp:// or smtps:// endpoint, not "${url}"`,
      );
    }
    if (LINE_BREAK.test(from)) {
      throw new UnusableMailConfigError(
        'MAIL_FROM must be a single-line address, not a header list',
      );
    }
    this.transport = transport ?? createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    for (const value of [message.to, message.subject]) {
      if (LINE_BREAK.test(value)) throw new UnsafeMailMessageError();
    }
    if (NOT_ONE_ADDRESS.test(message.to)) throw new UnsafeMailMessageError();

    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      throw new MailDeliveryError(deliveryReason(error));
    }
  }
}

/** An SMTP endpoint, with the credentials a self-hosted box needs inside it. `smtps://` is the
 * implicit-TLS form and `smtp://` the STARTTLS one; anything else is a URL that would send mail
 * somewhere that is not a mail server. Parsed, not pattern-matched: `new URL` is what decides
 * whether a string has a host in it. */
function isSmtpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'smtp:' || url.protocol === 'smtps:') && url.hostname.length > 0;
}

/**
 * Why the send failed, in a form that is safe to keep.
 *
 * The transport's own error text is not: it names the host and port, and on an authentication
 * failure nodemailer quotes the login it was handed. `failureReason` is a column that outlives
 * this attempt — read in an admin screen, copied into a ticket — so it gets the code and nothing
 * else. A failure with no code on it is still a failure worth recording, so that case says so
 * without saying anything about where it happened.
 */
function deliveryReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ERROR_CODE.test(code)) return code;

  const responseCode = (error as { responseCode?: unknown } | null)?.responseCode;
  if (typeof responseCode === 'number' && Number.isInteger(responseCode))
    return `smtp ${responseCode}`;

  return 'transport error';
}
