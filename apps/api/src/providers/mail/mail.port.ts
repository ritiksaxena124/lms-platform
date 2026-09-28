/**
 * How a notification leaves this platform, stated without naming a vendor SDK (ARCHITECTURE §6).
 *
 * One message, one recipient, no attachments, and an async `send` — async for the plainest reason
 * in the system: unlike the video port (§10), this one waits on somebody else's server, and a
 * caller must be able to wait with it or, better, not wait at all. Phase 6 hands `send` to an
 * outbox sweep rather than to a request, so mail being down cannot slow a booking down.
 *
 * Three rules are inherited from the ports that came before it.
 *
 * **The message says what happened, not where to go.** `event` is this platform's own
 * notification code — the same key the `EmailTemplate` row is filed under — and it is the only
 * identifier a log line may carry. A recipient address never goes into a log: it is personal data,
 * and a log file is rotated, shipped and grepped by people who have no business reading a
 * student's email out of it.
 *
 * **Layout lives in code, copy lives in the database.** By the time a message reaches this port it
 * is already rendered: `text` and `html` are both finished bodies for the same message, because a
 * mail client that cannot render HTML is a mail client that still has to deliver the news. Nothing
 * here builds a body out of a booking id or a course title.
 *
 * **A mail carries no secret.** No room address, no stored key, no token (§6 and §14). An email
 * sits in a provider's storage, in a sent folder, and in whichever device the recipient reads it
 * on, none of which this platform controls. Links point at a portal page that then asks who is
 * calling.
 */
export const MAIL = Symbol('MAIL');

/** One message to one recipient. The outbox owns the address book; this port owns the envelope. */
export interface MailMessage {
  /** The notification this message is, keyed the way the outbox and `EmailTemplate` key it. */
  event: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mail {
  /**
   * Whether this deployment delivers at all. The outbox asks before it tries, because a message
   * dropped by a box with no transport is not a message that was sent, and a row claiming it was
   * is worse than no row.
   */
  readonly delivers: boolean;
  /** Resolves when the transport accepted the message. Rejects with `MailDeliveryError` when it
   * did not — a rejection the outbox retries, not a condition this port swallows. */
  send(message: MailMessage): Promise<void>;
}

/** The configured transport is not one. Refused where the port is built, which is at boot: a
 * deployment should find out that its mail config would send nothing before a teacher waits for a
 * confirmation. Names the offending key so the fix is obvious in a log line. */
export class UnusableMailConfigError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'UnusableMailConfigError';
  }
}

/** A value that would write more headers into the message than this platform intends. Thrown, not
 * returned: a caller that hands over `a@example.com\r\nBcc: everyone` has a bug on its hands, and
 * dropping it quietly would hide an injection attempt rather than stop one. */
export class UnsafeMailMessageError extends Error {
  constructor() {
    super('Mail fields must not contain a line break: a header would be written from a value');
    this.name = 'UnsafeMailMessageError';
  }
}

/**
 * The transport refused the message.
 *
 * `reason` is what the outbox stores, and it is deliberately not the transport's own error text:
 * nodemailer writes the host, the port and — on an auth failure — the login it was handed into
 * that string. A column meant for diagnosing why nothing arrived is not a place to put the
 * credentials of the box they came from.
 */
export class MailDeliveryError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Mail transport rejected the message (${reason})`);
    this.name = 'MailDeliveryError';
    this.reason = reason;
  }
}
