import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ENV, EnvModule } from '../../config/env.module';
import { buildMail, MailModule } from './mail.module';
import { MAIL, type Mail } from './mail.port';
import { NoMail } from './no-mail.adapter';
import { SmtpMail } from './smtp-mail.adapter';

const SMTP = {
  SMTP_URL: 'smtp://user:pass@mail.internal.example:587',
  MAIL_FROM: 'LMS <no-reply@localtest.me>',
};

/**
 * Which transport the environment asks for, and what a deployment with no mail at all answers.
 * The switch is the presence of `SMTP_URL` (§6) rather than a `MAIL_PROVIDER` string, because
 * there is only one kind of transport to configure: a box either names an SMTP endpoint or it
 * has not decided yet.
 */
describe('mail provider selection', () => {
  it('builds the SMTP adapter for the transport the environment names', () => {
    expect(buildMail(SMTP)).toBeInstanceOf(SmtpMail);
  });

  it('builds a port that delivers nothing where no transport is configured', () => {
    const mail = buildMail({ SMTP_URL: undefined, MAIL_FROM: undefined });

    expect(mail).toBeInstanceOf(NoMail);
    // The question the outbox has to be able to ask: a dropped message is not a delivered one,
    // and a row claiming otherwise is worse than a row saying nothing happened.
    expect(mail.delivers).toBe(false);
  });

  it('still delivers nothing when a sender address is configured without a transport', () => {
    // `MAIL_FROM` alone is inert config, not a half-built mailer: SMTP_URL is the switch.
    expect(buildMail({ SMTP_URL: undefined, MAIL_FROM: SMTP.MAIL_FROM })).toBeInstanceOf(NoMail);
  });

  it('refuses a transport with no sender address, rather than letting the vendor guess one', () => {
    // Nodemailer would fall back to the login's own address, so the From header on a school's
    // mail would be decided by a credential string nobody wrote for that purpose.
    expect(() => buildMail({ SMTP_URL: SMTP.SMTP_URL, MAIL_FROM: undefined })).toThrow(/MAIL_FROM/);
  });

  it('refuses a URL that is not an SMTP endpoint, at the moment the port is built', () => {
    expect(() => buildMail({ ...SMTP, SMTP_URL: 'https://mail.internal.example' })).toThrow(
      /SMTP_URL/,
    );
  });

  it('refuses a URL with no endpoint in it at all', () => {
    expect(() => buildMail({ ...SMTP, SMTP_URL: 'smtps://' })).toThrow(/SMTP_URL/);
  });

  it('hands the port to anything that asks for it by token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, MailModule],
    })
      // Named here rather than inherited from the ambient environment, so the spec says what it
      // proves no matter what a developer's own .env has decided about mail.
      .overrideProvider(ENV)
      .useValue(SMTP)
      .compile();

    expect(moduleRef.get<Mail>(MAIL)).toBeInstanceOf(SmtpMail);
  });

  it('hands the no-mail port to the same token when the box has no transport', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, MailModule],
    })
      .overrideProvider(ENV)
      .useValue({ SMTP_URL: undefined, MAIL_FROM: undefined })
      .compile();

    expect(moduleRef.get<Mail>(MAIL)).toBeInstanceOf(NoMail);
  });
});
