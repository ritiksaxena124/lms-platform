import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaClient, type MailOutbox } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  MAIL_OUTBOX_STATUS_CODES,
  MAIL_RETRY_DELAYS_MINUTES,
  MAIL_SENDING_RECLAIM_MINUTES,
  MAIL_SWEEP_INTERVAL_MINUTES,
} from '@lms/shared';
import { AppModule } from '../src/app.module';
import { MailOutboxRepository } from '../src/modules/notifications/mail-outbox.repository';
import {
  MailDeliveryService,
  type MailDeliveryReport,
} from '../src/modules/notifications/mail-delivery.service';
import type { MailEnvelope } from '../src/modules/notifications/mail-queue.service';
import {
  MAIL,
  MailDeliveryError,
  type Mail,
  type MailMessage,
} from '../src/providers/mail/mail.port';
import { seedLookups } from '../src/reference/seed-lookups';
import { seedEmailTemplates } from '../src/reference/seed-email-templates';
import { createTestApp } from './utils/create-test-app';

/**
 * The mail queue's delivery run, in two halves: the seven statements it is written out of, and the
 * decisions those statements carry out.
 *
 * **The repository half** tests what has to be true no matter what the sweep decides, and the one
 * that matters most is the claim. A row is claimed by a status write, not by a lock that dies with
 * its connection. Two runs — the cron and a manual call, or two API processes on one database — must
 * never both put the same letter to a transport, because a student who is told the same confirmation
 * twice stops believing the queue. So `queued` sits in the update's `where` rather than being checked
 * after it, exactly as ownership is written in every other repository here: the statement is the
 * permission, and a second run that finds the row already `sending` finds no row at all. The other
 * thing worth pinning is *when* the address is read: 6c's promise is that a queued row carries no
 * address, so the sweep reads `User.email` as it claims, and a test that could not see the address in
 * the claimed row would let somebody move it back into the payload, where it goes stale the day a
 * person corrects their account.
 *
 * **The sweep half** tests the decisions a reader would notice were they wrong: which failure is
 * worth asking about again, how long a row waits for that ask, when a row stops being asked at all,
 * and what the queue says about a box that has no transport. The transport there is a stub. Nothing
 * in this file may reach a mail server — a suite that sent real mail would be a suite that mails a
 * stranger every time somebody runs the tests — and the stub is honest in both directions: it can
 * refuse with a real `MailDeliveryError`, and it can move a row out from under the run, which is what
 * a second process on one database looks like. 6f is where a real transport is pointed at a real
 * inbox.
 *
 * ## Why one file holds both halves
 *
 * A sweep is by nature global, and a row 6d filed is due the moment it exists. Two spec files
 * sweeping the same `lms_test` take each other's backdated rows and fail each other at random — this
 * file was two until they did. One file's tests run one at a time, so the queue has one sweeper.
 *
 * ## Why every sweep is asked for exactly the rows the test filed
 *
 * The other half of the same rule: each test files its own rows *hours in the past* and asks for a
 * page no larger than their number. Under those two rules the oldest `limit` due rows are provably
 * that test's own, so a sweep here neither mails another suite's queued news nor has its counts moved
 * by it. Raise a `limit` past the rows a test filed, or date its rows at the present like a real send
 * decision does, and the test starts stealing from whoever happens to be queued.
 *
 * The exception is `reclaimAbandoned`, which has no page. It is safe for the reason the booking
 * sweep is: its `where` is a fifteen-minute window on `updatedAt`, and no other suite ages a row that
 * far.
 *
 * ## Why one fixture writes raw SQL, and why the clock is a parameter
 *
 * `updatedAt` is Prisma's `@updatedAt` column, which refuses a value handed to it, and an abandoned
 * claim is by definition a row whose `updated_at` is old — so that one fixture moves that one column
 * through Postgres itself. Everything else about time is answered by passing the sweep the moment it
 * is standing in: a row due in five minutes and a row out of curve are both questions a test must not
 * have to wait for, and the fixtures are made old rather than the clock moved forward, because a
 * forward clock makes *every* row in the database overdue.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
/** Old enough that a row a real send decision filed seconds ago cannot outrank it. */
const OLD = 6 * MS_PER_HOUR;
const STATUS = MAIL_OUTBOX_STATUS_CODES;

const HREF = `http://student.localtest.me:3001/courses/${RUN}`;
/** The answers `booking_confirmed` asks the payload for. */
const CLASS_SLOTS = {
  course_title: 'Queue course',
  teacher_name: 'someone Person',
  when: 'Tue 09:00',
};

let app: INestApplication;
const prisma = new PrismaClient();
let outbox: MailOutboxRepository;
let student: { id: string; email: string };
let other: { id: string; email: string };
/** The account one test corrects out from under its own queued news, kept apart from the two the
 * rest of the file reads so that one mutation cannot change anybody else's assertions. */
let person: { id: string; email: string };

/** What this file wrote, so each test hands its rows back rather than leaving a queue the next test
 * has to reason about. */
const created: string[] = [];
const templates: string[] = [];

async function register(name: string): Promise<{ id: string; email: string }> {
  const email = emailFor(name);
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `${name} Person`, role: 'student' })
    .expect(201);
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  return { id: user.id, email };
}

/** A row as 6d would have filed it, except that its news is hours old. */
async function file(
  recipientUserId: string,
  overrides: {
    event?: string;
    slots?: Record<string, string>;
    status?: string;
    attempts?: number;
    dueMinutesAgo?: number;
    nextAttemptAt?: Date;
  } = {},
): Promise<MailOutbox> {
  const envelope: MailEnvelope = {
    slots: overrides.slots ?? CLASS_SLOTS,
    href: HREF,
  };
  const row = await prisma.mailOutbox.create({
    data: {
      eventCode: overrides.event ?? 'booking_confirmed',
      recipientUserId,
      payload: envelope,
      status: overrides.status ?? STATUS.QUEUED,
      attempts: overrides.attempts ?? 0,
      nextAttemptAt:
        overrides.nextAttemptAt ??
        new Date(Date.now() - OLD - (overrides.dueMinutesAgo ?? 0) * MS_PER_MINUTE),
    },
  });
  created.push(row.id);
  return row;
}

/** Copy this file owns, so a test can reword it or break it without touching a seeded row another
 * suite reads. Answers with the event code to file news against. */
async function copy(
  code: string,
  over: Partial<{ subject: string; ctaLabel: string | null }> = {},
): Promise<string> {
  const eventCode = `${RUN}.${code}`;
  const row = await prisma.emailTemplate.create({
    data: {
      eventCode,
      subject: over.subject ?? 'News about {course_title}',
      heading: 'News',
      bodyLines: ['Something happened in {course_title}.'],
      ctaLabel: over.ctaLabel ?? 'Open the course',
    },
  });
  templates.push(row.id);
  return eventCode;
}

const rowOf = (id: string) => prisma.mailOutbox.findUniqueOrThrow({ where: { id } });

/** Time travelling one column Prisma insists on writing itself. */
async function makeOld(id: string, minutes: number): Promise<void> {
  await prisma.$executeRaw`UPDATE mail_outbox SET updated_at = ${new Date(
    Date.now() - minutes * MS_PER_MINUTE,
  )} WHERE id = ${id}::uuid`;
}

interface StubOptions {
  delivers?: boolean;
  /** The refusal to answer with, given the message the transport was handed. */
  refuse?: (message: MailMessage) => Error | null;
  /** A chance to move the row while its letter is in the air. */
  duringSend?: (message: MailMessage) => Promise<void>;
}

class StubMail implements Mail {
  readonly delivers: boolean;
  readonly messages: MailMessage[] = [];
  private readonly options: StubOptions;

  constructor(options: StubOptions = {}) {
    this.delivers = options.delivers ?? true;
    this.options = options;
  }

  async send(message: MailMessage): Promise<void> {
    await this.options.duringSend?.(message);
    const refusal = this.options.refuse?.(message);
    if (refusal) throw refusal;
    this.messages.push(message);
  }
}

beforeAll(async () => {
  await seedLookups(prisma);
  await seedEmailTemplates(prisma);
  app = await createTestApp({ imports: [AppModule] });
  outbox = app.get(MailOutboxRepository);
  student = await register('dtmail');
  other = await register('dtalt');
  person = await register('dtcorr');
});

afterEach(async () => {
  await prisma.mailOutbox.deleteMany({ where: { id: { in: created } } });
  await prisma.emailTemplate.deleteMany({ where: { id: { in: templates } } });
  created.length = 0;
  templates.length = 0;
});

afterAll(async () => {
  await app?.close();
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
  await prisma.emailTemplate.deleteMany({ where: { eventCode: { startsWith: `${RUN}.` } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('the statements a delivery sweep is built out of', () => {
  it('takes the row that is due and leaves the row that is not', async () => {
    const now = new Date();
    const waiting = await file(student.id);
    await file(student.id, { nextAttemptAt: new Date(now.getTime() + MS_PER_HOUR) });
    const finished = await file(student.id, { status: STATUS.SENT });

    const claimed = await outbox.claimDue(now, 1);

    // One row asked for, and it is the queued one — the run that claims a `sent` row again is the
    // run that mails a person a class they were already told about.
    expect(claimed.map((row) => row.id)).toEqual([waiting.id]);
    expect((await rowOf(waiting.id)).status).toBe(STATUS.SENDING);
    expect((await rowOf(finished.id)).status).toBe(STATUS.SENT);
  });

  it('answers with the row as the claim left it: the ask counted, the address read now', async () => {
    const row = await file(person.id, { attempts: 2 });
    // The person on the row corrected their account after the news was filed. A row that carried the
    // address would answer with the old one; this answers with the account.
    const corrected = emailFor('dtmailfixed');
    await prisma.user.update({ where: { id: person.id }, data: { email: corrected } });

    const [claimed] = await outbox.claimDue(new Date(), 1);

    expect(claimed?.id).toBe(row.id);
    expect(claimed?.attempts).toBe(3);
    expect(claimed?.eventCode).toBe('booking_confirmed');
    expect(claimed?.recipient.email).toBe(corrected);
    expect(claimed?.payload).toMatchObject({ href: HREF });
    expect((await rowOf(row.id)).status).toBe(STATUS.SENDING);
  });

  it('claims a row once, whichever run got there first', async () => {
    const mine = new Set(
      (await Promise.all(Array.from({ length: 16 }, () => file(student.id)))).map((row) => row.id),
    );
    const now = new Date();

    // Two runs at one instant, which is what the cron plus a manual call, or two API processes on one
    // database, actually look like. Neither page may contain the other's row.
    const [once, twice] = await Promise.all([outbox.claimDue(now, 8), outbox.claimDue(now, 8)]);
    const ids = [...once, ...twice].map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => mine.has(id))).toBe(true);
    // The split is whichever way the race went; what is not available is a row in both hands, or an
    // ask counted twice for one attempt.
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(
      await prisma.mailOutbox.count({
        where: { id: { in: ids }, status: STATUS.SENDING, attempts: 1 },
      }),
    ).toBe(ids.length);
  });

  it('reclaims a claim that died with its process and leaves a live one alone', async () => {
    const abandoned = await file(student.id, { status: STATUS.SENDING, attempts: 1 });
    const inFlight = await file(other.id, { status: STATUS.SENDING, attempts: 1 });
    await makeOld(abandoned.id, MAIL_SENDING_RECLAIM_MINUTES + 30);

    const reclaimed = await outbox.reclaimAbandoned(new Date());

    expect(reclaimed).toBe(1);
    expect((await rowOf(abandoned.id)).status).toBe(STATUS.QUEUED);
    expect((await rowOf(inFlight.id)).status).toBe(STATUS.SENDING);
    // The reclaimed row keeps the ask it never reported. An abandoned send was still a send, and a
    // run that reset the count would give a poisoned row an infinite budget.
    expect((await rowOf(abandoned.id)).attempts).toBe(1);
  });

  it('takes a page of the queue, oldest news first', async () => {
    const now = new Date();
    const ids: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const row = await file(student.id, { dueMinutesAgo: 30 - index });
      ids.push(row.id);
    }

    const claimed = await outbox.claimDue(now, 25);

    expect(claimed).toHaveLength(25);
    // The page is a set rather than a list: `UPDATE ... RETURNING` hands back the rows it wrote in
    // whatever order the write found them, and the sweep's only promise is *which* 25 it took.
    expect(new Set(claimed.map((row) => row.id))).toEqual(new Set(ids.slice(0, 25)));
    // Which is the same promise as "last week's refusal does not wait behind this minute's
    // enrollment": the rows left in the queue are the newest ones.
    const left = await prisma.mailOutbox.findMany({
      where: { recipientUserId: student.id, status: STATUS.QUEUED },
      select: { id: true },
    });
    expect(left.map((row) => row.id).sort()).toEqual(ids.slice(25).sort());

    // The queue drains a page at a time rather than holding the process on one long run.
    const rest = await outbox.claimDue(now, 5);
    expect(new Set(rest.map((row) => row.id))).toEqual(new Set(ids.slice(25)));
  });

  it('finishes a claimed row, and refuses to finish one nobody claimed', async () => {
    const mine = await file(student.id, { status: STATUS.SENDING, attempts: 2 });
    const waiting = await file(student.id);
    const at = new Date();

    expect(await outbox.markSent(mine.id, at)).toBe(true);
    expect(await outbox.markSent(waiting.id, at)).toBe(false);

    const sent = await rowOf(mine.id);
    expect(sent.status).toBe(STATUS.SENT);
    expect(sent.sentAt?.toISOString()).toBe(at.toISOString());
    expect(sent.attempts).toBe(2);
    expect((await rowOf(waiting.id)).status).toBe(STATUS.QUEUED);
  });

  it('puts a row back with its next ask scheduled and the reason kept', async () => {
    const row = await file(student.id, { status: STATUS.SENDING, attempts: 2 });
    const next = new Date(Date.now() + 30 * MS_PER_MINUTE);

    expect(await outbox.requeue(row.id, next, 'EAUTH')).toBe(true);

    const after = await rowOf(row.id);
    expect(after.status).toBe(STATUS.QUEUED);
    expect(after.nextAttemptAt.toISOString()).toBe(next.toISOString());
    expect(after.failureReason).toBe('EAUTH');
    // The ask was already counted by the claim, which is what the retry curve is read against.
    expect(after.attempts).toBe(2);
  });

  it('ends a row that is out of attempts without moving its due time', async () => {
    const row = await file(student.id, { status: STATUS.SENDING, attempts: 6 });
    const before = await rowOf(row.id);

    expect(await outbox.markFailed(row.id, 'smtp 550')).toBe(true);

    const after = await rowOf(row.id);
    expect(after.status).toBe(STATUS.FAILED);
    expect(after.failureReason).toBe('smtp 550');
    expect(after.sentAt).toBeNull();
    // 6c's rule, honoured here: a terminal row keeps the time it was last due as a fact, and the
    // status is what says it is over.
    expect(after.nextAttemptAt.toISOString()).toBe(before.nextAttemptAt.toISOString());
  });

  it('drops the due rows on a box that sends no mail, without counting an ask', async () => {
    const now = new Date();
    const waiting = await file(student.id);
    const alsoWaiting = await file(other.id);
    await file(student.id, { nextAttemptAt: new Date(now.getTime() + MS_PER_HOUR) });

    const dropped = await outbox.dropDue(now, 2);

    expect(dropped).toBe(2);
    for (const id of [waiting.id, alsoWaiting.id]) {
      const row = await rowOf(id);
      expect(row.status).toBe(STATUS.DROPPED);
      // `attempts` counts times the transport was asked. This box has no transport, so a row it
      // threw away was never asked about — and 0 is the honest number beside `dropped`.
      expect(row.attempts).toBe(0);
    }
  });

  it('reads the standing copy by event code', async () => {
    const template = await outbox.findTemplate('booking_confirmed');

    expect(template).not.toBeNull();
    expect(template?.subject).toContain('{course_title}');
    expect(template?.ctaLabel).toBeTruthy();
    expect(template?.bodyLines.length).toBeGreaterThan(0);
  });

  it('reads nothing for an event with no copy, or with copy that stopped being sent', async () => {
    // An event with no row is not a database error and not a retry: it is a letter that cannot be
    // written until somebody files the copy (ARCHITECTURE §6, step 6c).
    expect(await outbox.findTemplate('a_event_nobody_writes')).toBeNull();

    const event = await copy('booking_confirmed');
    expect(await outbox.findTemplate(event)).not.toBeNull();

    await prisma.emailTemplate.update({ where: { eventCode: event }, data: { isActive: false } });
    // The operator's way of stopping one event without deleting the copy that describes it.
    expect(await outbox.findTemplate(event)).toBeNull();
  });
});

describe('the sweep that sends what the queue was told', () => {
  /** A run at the moment it is standing in, over exactly the rows the test filed. */
  function sweep(mail: Mail, limit: number, now = new Date()): Promise<MailDeliveryReport> {
    return new MailDeliveryService(outbox, mail).run(now, limit);
  }

  it('writes the letter from the row and the standing copy, and says it was sent', async () => {
    const row = await file(student.id);
    const mail = new StubMail();
    const now = new Date();

    const report = await sweep(mail, 1, now);

    expect(report).toMatchObject({ sent: 1, retried: 0, failed: 0, dropped: 0 });
    expect(mail.messages).toHaveLength(1);
    const message = mail.messages[0]!;
    expect(message.event).toBe('booking_confirmed');
    // The address is read off the account as the letter is written, which is the half of 6c's design
    // this file can prove: a person who corrected their email is mailed at the correction.
    expect(message.to).toBe(student.email);
    expect(message.subject).toContain('Queue course');
    expect(message.text).toContain('someone Person');
    // The link is the portal page the row carries. A class's room address is in no part of any
    // message (§6, §10) — the page it points at opens the room after asking who is calling.
    expect(message.html).toContain(HREF);
    expect(message.text).not.toContain('jitsi');

    const after = await rowOf(row.id);
    expect(after.status).toBe(STATUS.SENT);
    expect(after.sentAt?.toISOString()).toBe(now.toISOString());
    expect(after.attempts).toBe(1);
  });

  it('sends today’s copy about news it was told last week', async () => {
    const event = await copy('booking_confirmed', { subject: 'The old wording: {course_title}' });
    const row = await file(student.id, { event });

    // An operator rewords the confirmation. The letter that goes out carries the new sentence about
    // the old news — which is the reason the queue holds news rather than letters, and the reason a
    // reword cannot quietly change a fact somebody was already told.
    await prisma.emailTemplate.update({
      where: { eventCode: event },
      data: { subject: 'The new wording: {course_title}' },
    });
    const mail = new StubMail();

    await sweep(mail, 1);

    expect(mail.messages[0]!.subject).toBe('The new wording: Queue course');
    expect((await rowOf(row.id)).status).toBe(STATUS.SENT);
  });

  it('asks a refused row again on the curve, and keeps the reason the transport gave', async () => {
    const row = await file(student.id);
    const mail = new StubMail({ refuse: () => new MailDeliveryError('EAUTH') });
    const now = new Date();

    const report = await sweep(mail, 1, now);

    expect(report).toMatchObject({ sent: 0, retried: 1, failed: 0 });
    const after = await rowOf(row.id);
    expect(after.status).toBe(STATUS.QUEUED);
    // The first wait, read off the ask the claim just counted.
    expect(after.nextAttemptAt.toISOString()).toBe(
      new Date(now.getTime() + (MAIL_RETRY_DELAYS_MINUTES[0] ?? 1) * MS_PER_MINUTE).toISOString(),
    );
    expect(after.failureReason).toBe('EAUTH');
    expect(after.sentAt).toBeNull();
  });

  it('waits the whole curve before it stops asking, and stops after the sixth ask', async () => {
    const waits = MAIL_RETRY_DELAYS_MINUTES;
    const rows = await Promise.all(
      waits.map((_, asked) => file(student.id, { attempts: asked, dueMinutesAgo: asked + 1 })),
    );
    // A row that has already been asked as many times as there are waits has no wait left in it.
    const spent = await file(student.id, { attempts: waits.length, dueMinutesAgo: 6 });
    const now = new Date();

    const report = await sweep(
      new StubMail({ refuse: () => new MailDeliveryError('smtp 421') }),
      rows.length + 1,
      now,
    );

    expect(report).toMatchObject({ sent: 0, retried: waits.length, failed: 1 });
    for (const [asked, row] of rows.entries()) {
      const after = await rowOf(row.id);
      // The claim counted the ask this run just made, and the wait after it is the curve's answer to
      // that number — so a row is asked at most once per run, and gives up inside a day.
      expect(after.attempts).toBe(asked + 1);
      expect(after.status).toBe(STATUS.QUEUED);
      expect(after.nextAttemptAt.toISOString()).toBe(
        new Date(now.getTime() + (waits[asked] ?? 0) * MS_PER_MINUTE).toISOString(),
      );
    }

    const finished = await rowOf(spent.id);
    expect(finished.status).toBe(STATUS.FAILED);
    expect(finished.failureReason).toBe('smtp 421');
    // 6c's rule: a finished row keeps the time it was due and gains no send.
    expect(finished.sentAt).toBeNull();
  });

  it('ends a row whose letter cannot be written instead of asking it again', async () => {
    const noCopy = await file(student.id, { event: `${RUN}.nothing_files_this` });
    // Copy an operator broke: a subject spanning two lines is two headers, so the renderer refuses it
    // (6b) — and the same refusal will arrive every time, so another ask buys nothing.
    const broken = await copy('booking_refused', { subject: 'Two lines\nof subject' });
    const badCopy = await file(student.id, { event: broken, dueMinutesAgo: 1 });
    // A row 6d did not file at all: the table is readable by a report, and a payload that holds no
    // envelope is a fact about the table rather than a crash in the sweep.
    const shapeless = await prisma.mailOutbox.create({
      data: {
        eventCode: 'booking_confirmed',
        recipientUserId: student.id,
        payload: {},
        nextAttemptAt: new Date(Date.now() - OLD - 2 * MS_PER_MINUTE),
      },
    });
    created.push(shapeless.id);

    const mail = new StubMail();

    expect(await sweep(mail, 3)).toMatchObject({ sent: 0, failed: 3, retried: 0 });
    // None of the three reached a transport: a letter that cannot be written is not a mail server
    // that said no, and it would be wrong to blame the box or to ask it again.
    expect(mail.messages).toHaveLength(0);
    for (const id of [noCopy.id, badCopy.id, shapeless.id]) {
      const after = await rowOf(id);
      expect(after.status).toBe(STATUS.FAILED);
      expect(after.failureReason).toBeTruthy();
    }
  });

  it('hands a box with no transport the news it will not send, and says nothing was sent', async () => {
    const row = await file(student.id);
    const mail = new StubMail({ delivers: false });

    expect(await sweep(mail, 1)).toMatchObject({ sent: 0, dropped: 1 });
    expect(mail.messages).toHaveLength(0);
    const after = await rowOf(row.id);
    // `dropped` rather than `failed`, and `attempts` still 0: nothing was asked, so nothing refused.
    // On a deployment with no SMTP box the honest record is that the news went nowhere.
    expect(after.status).toBe(STATUS.DROPPED);
    expect(after.attempts).toBe(0);
    expect(after.failureReason).toBeNull();
  });

  it('takes back a claim whose process is gone and sends it in the same run', async () => {
    const row = await file(student.id, { status: STATUS.SENDING, attempts: 1 });
    await makeOld(row.id, MAIL_SENDING_RECLAIM_MINUTES + 25);
    const mail = new StubMail();

    expect(await sweep(mail, 1)).toMatchObject({ reclaimed: 1, sent: 1 });
    const after = await rowOf(row.id);
    expect(after.status).toBe(STATUS.SENT);
    // The abandoned ask is still an ask.
    expect(after.attempts).toBe(2);
  });

  it('leaves a row it cannot explain for a later run, and carries on with the page', async () => {
    // A refusal the sweep has no case for — a mail host that is down, a bug in the renderer — is not
    // this row's fault. Writing it off would be the queue deciding that a person whose news is
    // perfectly sendable should never hear about it, so the row keeps the claim it was given and the
    // reclaim picks it up once that is older than a run.
    const surprise = await file(student.id);
    const fine = await file(other.id, {
      event: 'enrollment_left',
      slots: { course_title: 'Queue course' },
      dueMinutesAgo: 1,
    });

    const mail = new StubMail({
      refuse: (message) =>
        message.event === 'booking_confirmed' ? new Error('the mail host is not answering') : null,
    });

    expect(await sweep(mail, 2)).toMatchObject({ sent: 1, unresolved: 1, failed: 0 });
    expect((await rowOf(surprise.id)).status).toBe(STATUS.SENDING);
    expect((await rowOf(fine.id)).status).toBe(STATUS.SENT);
  });

  it('does not report a letter as sent on a row that stopped being its own', async () => {
    const row = await file(student.id);
    // Another process's reclaim, arriving between this run's send and its write. The row is not this
    // run's to finish, and a queue that said it was would be a queue that lies about what went out —
    // which is why the terminal writes answer with whether the row was still theirs.
    const mail = new StubMail({
      duringSend: async () => {
        await prisma.mailOutbox.update({ where: { id: row.id }, data: { status: STATUS.QUEUED } });
      },
    });

    expect(await sweep(mail, 1)).toMatchObject({ sent: 0, released: 1 });
    expect((await rowOf(row.id)).status).toBe(STATUS.QUEUED);
  });

  it('is on a clock as well as in this file', () => {
    // Nothing calls the sweep over HTTP, so a cron that stopped being registered would leave every
    // test above green while the queue filled and nobody was told. The name is spelled out rather
    // than read from the service because a renamed job is a job ops cannot find.
    const scheduler = app.get(SchedulerRegistry);
    const job = scheduler.getCronJob('mail-outbox-delivery');
    expect(job.isActive).toBe(true);
    expect(job.nextDate().toMillis() - Date.now()).toBeLessThanOrEqual(
      MAIL_SWEEP_INTERVAL_MINUTES * MS_PER_MINUTE,
    );
  });

  it('is wired to the transport the deployment configured, not one it invented', () => {
    // The provider graph is the only thing that connects this sweep to 6a's port, and a service that
    // built its own transporter would pass every test above while mailing nothing in production. On
    // this box `SMTP_URL` is unset, so the configured transport is the one that says it sends
    // nothing — which is the other half of the port's promise.
    expect(app.get(MailDeliveryService)).toBeInstanceOf(MailDeliveryService);
    expect(app.get<Mail>(MAIL).delivers).toBe(false);
  });
});
