import { Module } from '@nestjs/common';

import type { AppEnv } from '../../config/env';
import { ENV } from '../../config/env.module';
import { type Mail, MAIL, UnusableMailConfigError } from './mail.port';
import { NoMail } from './no-mail.adapter';
import { SmtpMail } from './smtp-mail.adapter';

/** The part of the environment this choice needs — spelled out so a spec can name a transport
 * without inventing a whole config. */
export type MailEnv = Pick<AppEnv, 'SMTP_URL' | 'MAIL_FROM'>;

/**
 * The one place a transport setting becomes an object.
 *
 * `SMTP_URL` is the switch rather than a `MAIL_PROVIDER` string, because there is one kind of mail
 * transport to configure: a box either names an SMTP endpoint or it has not decided yet (§6). Both
 * answers are complete, and the undecided one is a deployment people run.
 *
 * A URL without a sender is refused here, at boot, rather than at the first send. Nodemailer would
 * quietly use the login's own address as `From`, which is the wrong direction for a silent failure
 * to go: a school's mail arriving with a credential string in the header, months after the config
 * that caused it.
 */
export function buildMail(env: MailEnv): Mail {
  if (!env.SMTP_URL) return new NoMail();
  if (!env.MAIL_FROM) {
    throw new UnusableMailConfigError('MAIL_FROM is required when SMTP_URL is set');
  }
  return new SmtpMail(env.SMTP_URL, env.MAIL_FROM);
}

@Module({
  providers: [
    {
      provide: MAIL,
      useFactory: (env: AppEnv) => buildMail(env),
      inject: [ENV],
    },
  ],
  exports: [MAIL],
})
export class MailModule {}
