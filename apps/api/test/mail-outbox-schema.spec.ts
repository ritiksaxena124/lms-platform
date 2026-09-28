import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LKP_TYPE_CODES, MAIL_OUTBOX_STATUS_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `mail_outbox` table promises with no scheduler in the way: that a row files the news
 * rather than the letter, names the person the news is for rather than their address, and is due
 * the moment it is written.
 *
 * Which rows are due, how many times one may be tried and what a transport's refusal means are
 * the sweep's decisions (Phase 6e), and the mail port already owns the rules about what may be
 * sent at all (§6). This table is underneath both: it cannot know that `sending` means somebody
 * else is already dialing, and it cannot sanitize a failure reason it was never given.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let studentRoleId: string;
let activeStatusId: string;

const createPerson = (name: string) =>
  prisma.user.create({
    data: {
      email: emailFor(name),
      passwordHash: 'scrypt$placeholder',
      fullName: 'Mail Outbox Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId: studentRoleId,
      statusValueId: activeStatusId,
    },
  });

/** The payload the send decision would have made available in 6d: answers to a template's slot
 * names, as the facts stood at the moment the news happened. */
const NEWS = {
  when: 'Monday 28 September, 09:30–10:15',
  course: 'Fractions, the slow way',
  holdUntil: '09:30 on 29 September',
};

const queue = (userId: string, overrides: Record<string, unknown> = {}) =>
  prisma.mailOutbox.create({
    data: {
      eventCode: `${RUN}.booking_requested`,
      recipientUserId: userId,
      payload: NEWS,
      ...overrides,
    },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  studentRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.STUDENT);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
});

afterAll(async () => {
  // The order is the restriction: a person with a letter waiting cannot be deleted, so the rows
  // they are addressed to go first.
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('mail_outbox table', () => {
  it('files the news, and says it is due', async () => {
    const person = await createPerson('due');

    const created = await queue(person.id);

    // A row is written inside the transaction that made the news, so what it holds is the event
    // and the facts — not a rendered document. The letter is assembled when the sweep goes to
    // send it, which is what makes a retry able to succeed at all: a reworded template or a
    // corrected sentence repairs a queued row instead of leaving it wrong forever.
    expect(created).toMatchObject({
      eventCode: `${RUN}.booking_requested`,
      recipientUserId: person.id,
      status: MAIL_OUTBOX_STATUS_CODES.QUEUED,
      attempts: 0,
      sentAt: null,
      failureReason: null,
      isActive: true,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    // Due immediately. A nullable "when may this be tried again" would make `null` mean two
    // things — never scheduled, and never again — and the sweep has to tell those apart.
    expect(created.nextAttemptAt).toBeInstanceOf(Date);
    expect(created.nextAttemptAt.getTime()).toBeLessThanOrEqual(
      created.createdAt.getTime() + 1_000,
    );
  });

  it('holds the payload as answers to slot names, and nothing else', async () => {
    const person = await createPerson('payload');
    const created = await queue(person.id);

    // The payload is keyed by the names the copy asks for, because that is the whole contract
    // between a send decision and a template row. `jsonb` is the first of its kind in this schema
    // and it does not keep the writer's key order — nothing here is read by position, and a row
    // that had to be read in order would be a document rather than a set of answers.
    const read = await prisma.mailOutbox.findFirstOrThrow({ where: { id: created.id } });
    expect(read.payload).toEqual(NEWS);

    // An answer is a string, so the renderer's `{when}` reaches a reader as a sentence rather than
    // as an object. The nesting the payload could carry is the 6d caller's habit to break, not a
    // rule the table states.
    await expect(
      prisma.mailOutbox.update({
        where: { id: created.id },
        data: { payload: { when: 'Monday' } },
      }),
    ).resolves.toMatchObject({ payload: { when: 'Monday' } });
  });

  it('names a person, never an address', async () => {
    const person = await createPerson('columns');
    const created = await queue(person.id);

    // There is no column to put one in, and that is the promise rather than an omission: an
    // address copied into a queue table outlives the correction the person made to their account,
    // and outlives the deletion they asked for. The sweep reads the address off `users` at the
    // moment it sends, so a letter queued before somebody fixed a typo goes to the fixed one — and
    // a log line about this row can name the recipient's id, which §6 allows and an address would
    // not.
    expect(Object.keys(created).sort()).toEqual(
      [
        'attempts',
        'createdAt',
        'eventCode',
        'failureReason',
        'id',
        'isActive',
        'nextAttemptAt',
        'payload',
        'recipientUserId',
        'sentAt',
        'status',
        'updatedAt',
      ].sort(),
    );
  });

  it('will not name a person who does not exist', async () => {
    await expect(queue(randomUUID())).rejects.toThrow();
  });

  it('will not let a person with a letter waiting disappear underneath them', async () => {
    const person = await createPerson('kept');
    await queue(person.id);

    // The same restriction a booking keeps its course alive for: the row is the record that this
    // account was told something, and a sweep that could not resolve an address for it would have
    // to invent a status for "sent to nobody". Accounts are deactivated rather than deleted, so
    // this is a ceiling on a mistake rather than a rule anyone will meet.
    await expect(prisma.user.delete({ where: { id: person.id } })).rejects.toThrow();
  });

  it('makes no decision about which events are worth sending, or what a status means', async () => {
    const person = await createPerson('arbitrary');

    // Both halves are code's business. Which events a notification exists for is the list in
    // `@lms/shared` that 6d names, and an event code with no template row is a message the sweep
    // refuses to render rather than a foreign key that would have failed the booking — a
    // notification is never the reason a request happened.
    await expect(
      queue(person.id, { eventCode: `${RUN}.anything_at_all`, payload: {} }),
    ).resolves.toMatchObject({ status: MAIL_OUTBOX_STATUS_CODES.QUEUED, payload: {} });

    // A status outside the list is acceptable to the table for the same reason a mime type is
    // acceptable to `lesson_asset`: the column records what a writer believed, and the sweep's
    // transitions are proved where the transitions live.
    await expect(queue(person.id, { status: 'invented_by_a_test' })).resolves.toMatchObject({
      status: 'invented_by_a_test',
    });
  });

  it('lets one piece of news be filed twice, and decides nothing about which row goes', async () => {
    const person = await createPerson('doubles');

    const first = await queue(person.id);
    const second = await queue(person.id, { status: MAIL_OUTBOX_STATUS_CODES.SENDING });

    // Nothing here says "one message per event per person", and it could not say it usefully: the
    // same news legitimately happens twice to the same reader — a student enrolling, leaving and
    // enrolling again — and a unique pair would refuse the second one inside the transaction that
    // was only trying to record a place. So there is no queue table in this schema.
    expect(second.id).not.toBe(first.id);

    // Two rows in `sending` for the same event both stand, because "at most one attempt in flight"
    // is the sweep's claim, not a constraint: the table cannot know that a second writer already
    // has the row open.
    const inFlight = await prisma.mailOutbox.findMany({
      where: { eventCode: `${RUN}.booking_requested`, status: MAIL_OUTBOX_STATUS_CODES.SENDING },
    });
    expect(inFlight.map((row) => row.id)).toEqual([second.id]);
  });

  it('answers the question the sweep asks, and keeps the answer after the last one', async () => {
    const person = await createPerson('due-set');

    const now = new Date('2026-09-28T09:00:00.000Z');
    const waiting = await queue(person.id, { nextAttemptAt: new Date(now.getTime() - 60_000) });
    const later = await queue(person.id, { nextAttemptAt: new Date(now.getTime() + 60 * 60_000) });

    // The sweep's whole read: what is waiting, ordered by how long it has been waiting. Both
    // halves of that are columns here, which is why the attempt clock is a column rather than
    // `createdAt` plus a number the sweep would have to keep in step with itself.
    const due = await prisma.mailOutbox.findMany({
      where: {
        id: { in: [waiting.id, later.id] },
        status: { in: [MAIL_OUTBOX_STATUS_CODES.QUEUED, MAIL_OUTBOX_STATUS_CODES.SENDING] },
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
    });
    expect(due.map((row) => row.id)).toEqual([waiting.id]);

    // And a finished row keeps its due time as the last fact it was written with, rather than
    // clearing it to mean "never again" — which is the same reason `sentAt` is what says no.
    const sent = await prisma.mailOutbox.update({
      where: { id: waiting.id },
      data: { status: MAIL_OUTBOX_STATUS_CODES.SENT, sentAt: now, attempts: 1 },
    });
    expect(sent.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('keeps a failure as the short reason the port allowed', async () => {
    const person = await createPerson('failed');
    const created = await queue(person.id);

    // The column takes any string, and 6a's adapter is what guarantees the string is short and
    // sterile: `MailDeliveryError.reason` is a transport code (`EAUTH`, `smtp 550`) rather than
    // nodemailer's message, which names the host, the port and on an auth failure the login. A
    // CHECK on shape would be a second, weaker copy of that guarantee in the wrong place.
    const marked = await prisma.mailOutbox.update({
      where: { id: created.id },
      data: {
        status: MAIL_OUTBOX_STATUS_CODES.FAILED,
        failureReason: 'smtp 550',
        attempts: 5,
      },
    });
    expect(marked).toMatchObject({ status: 'failed', failureReason: 'smtp 550', attempts: 5 });
  });
});
