import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type MailOutbox } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_OUTBOX_STATUS_CODES, MAIL_SENDING_RECLAIM_MINUTES } from '@lms/shared';
import { AppModule } from '../src/app.module';
import { MailOutboxRepository } from '../src/modules/notifications/mail-outbox.repository';
import type { MailEnvelope } from '../src/modules/notifications/mail-queue.service';
import { seedLookups } from '../src/reference/seed-lookups';
import { seedEmailTemplates } from '../src/reference/seed-email-templates';
import { createTestApp } from './utils/create-test-app';

/**
 * The seven statements the delivery sweep is built out of, and nothing else.
 *
 * The sweep's decisions — which failure is worth another ask, how long a row waits for it, when a
 * row is finished — are `MailDeliveryService`'s, and they are tested beside a stub transport in
 * `mail-delivery.spec.ts`. This file tests the statements those decisions are made of, and the one
 * that matters most is the claim:
 *
 * A row is claimed by a status write, not by a lock that dies with its connection. Two runs — the
 * cron and a manual call, or two API instances on one database — must never both put the same
 * letter to a transport, because a student who is told the same confirmation twice stops believing
 * the queue. So `queued` sits in the `where` clause of the update rather than being checked after
 * it, exactly as ownership is written in every other repository here: the statement is the
 * permission, and a second run that finds the row already `sending` finds no row at all.
 *
 * The other thing worth pinning is *when* the address is read. 6c's promise is that a queued row
 * carries no address, so the sweep reads `User.email` as it claims — and a test that could not see
 * the address in the claimed row would let somebody move it back into the payload, where it goes
 * stale the day a person corrects their account.
 *
 * ## Why this file backdates its rows and never over-asks for them
 *
 * A sweep is by nature global: `next_attempt_at` defaults to the moment of writing, so every row
 * 6d's send decisions file is due as soon as it exists, including the rows the other mail suites
 * are holding while this file runs. Two rules keep this file inside its own queue. Every row it
 * creates is dated hours in the past, which makes it strictly older than anything a real write
 * produced; and every page it asks for is no larger than the number of rows the test just created.
 * Under those two rules the oldest `limit` due rows are, by construction, this file's rows — so a
 * claim here cannot strand another suite's row in `sending`, and the counts below can be exact
 * rather than `toBeGreaterThanOrEqual`. Raise a `limit` past the rows a test made and the test
 * starts stealing; that is the one edit this file does not survive.
 *
 * The exception is `reclaimAbandoned`, which has no page. It is safe for the same reason the
 * booking sweep is: its `where` is a fifteen-minute window on `updated_at`, and no other suite
 * ages a row that far.
 *
 * ## Why one fixture writes raw SQL
 *
 * `updatedAt` is Prisma's `@updatedAt` column, which refuses a value handed to it, and an abandoned
 * claim is by definition a row whose `updated_at` is old. That fixture moves the one column through
 * Postgres itself; nothing else in this file does, and nothing outside a fixture would.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
/** Old enough that a row a real send decision filed seconds ago cannot outrank it. */
const OLD = 6 * MS_PER_HOUR;
const STATUS = MAIL_OUTBOX_STATUS_CODES;

const ENVELOPE: MailEnvelope = {
  slots: { course_title: 'Queue course', teacher_name: 'someone Person' },
  href: 'http://student.localtest.me:3001/my-classes',
};

let app: INestApplication;
const prisma = new PrismaClient();
let outbox: MailOutboxRepository;
let first: string;
let second: string;

/** Every row this file created, so each test can hand its own rows back instead of leaving a queue
 * full of half-claimed rows for the next test to trip over. */
const created: string[] = [];

async function register(name: string): Promise<string> {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email: emailFor(name),
      password: PASSWORD,
      fullName: `${name} Person`,
      role: 'student',
    })
    .expect(201);
  const user = await prisma.user.findFirstOrThrow({ where: { email: emailFor(name) } });
  return user.id;
}

/** A row the sweep could take, in the state 6d's write leaves it in: `queued`, one ask short of
 * being asked, and due — due some hours ago, which is what makes the page this file asks for
 * belong to this file. */
async function due(
  recipientUserId: string,
  overrides: {
    event?: string;
    status?: string;
    attempts?: number;
    dueMinutesAgo?: number;
    nextAttemptAt?: Date;
  } = {},
): Promise<MailOutbox> {
  const row = await prisma.mailOutbox.create({
    data: {
      eventCode: overrides.event ?? 'booking_confirmed',
      recipientUserId,
      payload: ENVELOPE,
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

const rowOf = (id: string) => prisma.mailOutbox.findUniqueOrThrow({ where: { id } });

/** Time travelling one column Prisma insists on writing itself. */
async function makeOld(id: string, minutes: number): Promise<void> {
  await prisma.$executeRaw`UPDATE mail_outbox SET updated_at = ${new Date(
    Date.now() - minutes * MS_PER_MINUTE,
  )} WHERE id = ${id}::uuid`;
}

describe('the statements a delivery sweep is built out of', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    await seedEmailTemplates(prisma);
    app = await createTestApp({ imports: [AppModule] });
    outbox = app.get(MailOutboxRepository);
    first = await register('dtmail');
    second = await register('dtalt');
  });

  afterEach(async () => {
    await prisma.mailOutbox.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.emailTemplate.deleteMany({ where: { eventCode: { startsWith: `${RUN}.` } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('takes the row that is due and leaves the row that is not', async () => {
    const now = new Date();
    const waiting = await due(first);
    await due(first, { nextAttemptAt: new Date(now.getTime() + MS_PER_HOUR) });
    const finished = await due(first, { status: STATUS.SENT });

    const claimed = await outbox.claimDue(now, 1);

    // One row asked for, and it is the queued one — the run that claims a `sent` row again is the
    // run that mails a person a class they were already told about.
    expect(claimed.map((row) => row.id)).toEqual([waiting.id]);
    expect((await rowOf(waiting.id)).status).toBe(STATUS.SENDING);
    expect((await rowOf(finished.id)).status).toBe(STATUS.SENT);
  });

  it('answers with the row as the claim left it: the ask counted, the address read now', async () => {
    const row = await due(first, { attempts: 2 });
    // The person on the row corrected their account after the news was filed. A row that carried
    // the address would answer with the old one; this answers with the account.
    const corrected = emailFor('dtmailfixed');
    await prisma.user.update({ where: { id: first }, data: { email: corrected } });

    const [claimed] = await outbox.claimDue(new Date(), 1);

    expect(claimed?.id).toBe(row.id);
    expect(claimed?.attempts).toBe(3);
    expect(claimed?.eventCode).toBe('booking_confirmed');
    expect(claimed?.recipient.email).toBe(corrected);
    expect(claimed?.payload).toMatchObject(ENVELOPE);
    expect((await rowOf(row.id)).status).toBe(STATUS.SENDING);
  });

  it('claims a row once, whichever run got there first', async () => {
    const mine = new Set(
      (await Promise.all(Array.from({ length: 16 }, () => due(first)))).map((row) => row.id),
    );
    const now = new Date();

    // Two runs at one instant, which is what the cron plus a manual call, or two API instances on
    // one database, actually look like. Neither page may contain the other's row.
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
    const abandoned = await due(first, { status: STATUS.SENDING, attempts: 1 });
    const inFlight = await due(second, { status: STATUS.SENDING, attempts: 1 });
    await makeOld(abandoned.id, MAIL_SENDING_RECLAIM_MINUTES + 30);

    const reclaimed = await outbox.reclaimAbandoned(new Date());

    expect(reclaimed).toBe(1);
    expect((await rowOf(abandoned.id)).status).toBe(STATUS.QUEUED);
    expect((await rowOf(inFlight.id)).status).toBe(STATUS.SENDING);
    // The reclaimed row keeps the ask it never reported. An abandoned send was still a send, and a
    // run that reset the count would keep a poisoned row retrying forever.
    expect((await rowOf(abandoned.id)).attempts).toBe(1);
  });

  it('takes a page of the queue, oldest news first', async () => {
    const now = new Date();
    const ids: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const row = await due(first, { dueMinutesAgo: 30 - index });
      ids.push(row.id);
    }

    const claimed = await outbox.claimDue(now, 25);

    expect(claimed).toHaveLength(25);
    // The page is a set rather than a list: `UPDATE ... RETURNING` gives back the rows it wrote in
    // whatever order the write found them, and the sweep's only promise is which 25 it took.
    expect(new Set(claimed.map((row) => row.id))).toEqual(new Set(ids.slice(0, 25)));
    // Which is the same promise as "last week's refusal does not wait behind this minute's
    // enrollment": the five rows left in the queue are the five newest.
    const left = await prisma.mailOutbox.findMany({
      where: { recipientUserId: first, status: STATUS.QUEUED },
      select: { id: true },
    });
    expect(left.map((row) => row.id).sort()).toEqual(ids.slice(25).sort());

    // The queue drains a page at a time rather than holding the process on one long run.
    const rest = await outbox.claimDue(now, 5);
    expect(new Set(rest.map((row) => row.id))).toEqual(new Set(ids.slice(25)));
  });

  it('finishes a claimed row, and refuses to finish one nobody claimed', async () => {
    const mine = await due(first, { status: STATUS.SENDING, attempts: 2 });
    const waiting = await due(first);
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
    const row = await due(first, { status: STATUS.SENDING, attempts: 2 });
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
    const row = await due(first, { status: STATUS.SENDING, attempts: 6 });
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
    const waiting = await due(first);
    const alsoWaiting = await due(second);
    await due(first, { nextAttemptAt: new Date(now.getTime() + MS_PER_HOUR) });

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

    const filed = await prisma.emailTemplate.create({
      data: {
        eventCode: `${RUN}.booking_confirmed`,
        subject: 'A class you booked',
        heading: 'Booked',
        bodyLines: ['We have you down.'],
        ctaLabel: 'See your classes',
      },
    });
    expect(await outbox.findTemplate(filed.eventCode)).not.toBeNull();

    await prisma.emailTemplate.update({
      where: { id: filed.id },
      data: { isActive: false },
    });
    // The operator's way of stopping one event without deleting the copy that describes it.
    expect(await outbox.findTemplate(filed.eventCode)).toBeNull();
  });
});
