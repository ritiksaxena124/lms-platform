import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * What the `email_template` table promises with no HTTP and no renderer in the way: that the
 * sentences of a notification are data, and that one event has exactly one set of them.
 *
 * Phase 6 split an email into layout (code) and copy (this table) — see README, Phase 6 — so the
 * columns below are all things an operator may want to reword without a deploy, and none of them
 * is a document. A finished HTML body in a row would be markup no test had ever rendered and one
 * bad edit away from breaking Outlook for every recipient, which is the reason this table holds
 * lines rather than a page.
 */
const RUN = randomUUID().slice(0, 8);
const codeFor = (suffix: string) => `${RUN}.${suffix}`;

const prisma = new PrismaClient();

const written = (eventCode: string, overrides: Record<string, unknown> = {}) =>
  prisma.emailTemplate.create({
    data: {
      eventCode,
      subject: 'A minute has been asked for',
      heading: '{teacherName}, a student wants a class',
      bodyLines: [
        '{studentName} asked for {when}, on {course}.',
        'The minute is held until {holdUntil}.',
      ],
      ctaLabel: 'Answer the request',
      ...overrides,
    },
  });

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.emailTemplate.deleteMany({ where: { eventCode: { startsWith: `${RUN}.` } } });
  await prisma.$disconnect();
});

describe('email_template table', () => {
  it('holds the copy it was given, in the order the sentences were written', async () => {
    const created = await written(codeFor('copy'));

    // The subject is a header line and the heading is the first thing a reader sees, so they are
    // separate columns rather than one field used twice: a subject has to work in a list of
    // unread mail, and a heading has to work at 600px wide. Body lines stay an array because the
    // renderer prints them in order, one paragraph each — a single text blob would make "add a
    // sentence between these two" a string edit rather than an array index.
    expect(created).toMatchObject({
      eventCode: codeFor('copy'),
      subject: 'A minute has been asked for',
      heading: '{teacherName}, a student wants a class',
      bodyLines: [
        '{studentName} asked for {when}, on {course}.',
        'The minute is held until {holdUntil}.',
      ],
      ctaLabel: 'Answer the request',
      isActive: true,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('will not let two rows answer the same event, even after one of them retires', async () => {
    const kept = await written(codeFor('shared'));
    await prisma.emailTemplate.update({ where: { id: kept.id }, data: { isActive: false } });

    // `event_code` is unique forever rather than among the active rows, which is the identity half
    // of the split §2 describes, and the choice is worth its reason: the code names a thing that
    // happens in the product, not a business record somebody might re-create. If a retired
    // template ever came back, that is the same event being described twice, and the reader would
    // get whichever row `findFirst` reached first. Rewording an event is an update of the standing
    // row; who changed it and when is Phase 7's action log, not a second row here.
    await expect(written(codeFor('shared'))).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a message with no action, and one with no sentences', async () => {
    const plain = await written(codeFor('plain'), { ctaLabel: null, bodyLines: [] });

    // A notification that only tells the reader something — "your class was cancelled" with a page
    // they can already find — has no button, and `ctaLabel: null` is how the row says so. An empty
    // `bodyLines` is accepted for the same reason `lesson_asset` accepts a zero-byte file (§10):
    // what a message needs in order to be worth sending is the renderer's and the send decision's
    // judgement, not a column's. A check constraint here would also make the next kind of
    // notification a migration rather than a row.
    expect(plain).toMatchObject({ ctaLabel: null, bodyLines: [] });
  });

  it('says nothing about whether the message was sent', async () => {
    const created = await written(codeFor('nostatus'));

    // There is no status, no attempt count and no `sentAt` on this table, and that is the design:
    // a template is what a message says, and an outbox row is one particular message that has to
    // leave. Putting the two in one table would make every retry an edit of the copy's row, and
    // the copy would then carry a history of somebody's mail host being down.
    expect(Object.keys(created).sort()).toEqual(
      [
        'bodyLines',
        'createdAt',
        'ctaLabel',
        'eventCode',
        'heading',
        'id',
        'isActive',
        'subject',
        'updatedAt',
      ].sort(),
    );
  });
});
