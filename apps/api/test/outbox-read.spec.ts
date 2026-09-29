import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  API_ERROR_CODES,
  MAIL_EVENT_CODES,
  MAIL_OUTBOX_STATUS_CODES,
  ROLE_CODES,
  type OutboxListResponse,
} from '@lms/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import {
  BOOKING_MAIL_EVENTS,
  MailQueue,
  type BookingMailEvent,
  type EnrollmentMailEvent,
} from '../src/modules/notifications/mail-queue.service';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Asking the queue what is waiting.
 *
 * Phase 6 gave the outbox a writer and a sweep, and no way for a person to read it, which meant the
 * only answer to "did my confirmation go?" was a log line nobody is allowed to grep on a VPS. So the
 * claims here are the two an operator actually makes — what is still waiting, and what has this
 * person's rows done — plus the shape of an answer, which is where this route draws its line.
 *
 * The line is drawn against `payload`, and against an address. A row's payload is the copy's answers
 * (a course title, a name, an href), and none of them is a fact an operator needs in order to decide
 * whether to re-ask a mail host; the moment a read route exposes the column, it becomes the place
 * senders dump whatever they had to hand. The address is the same argument §18 makes about the
 * ledger: `mail_outbox` names a recipient by id so that no copy of the address can outlive the
 * person's correction to it, and a route that resolved that id into an email on the way out would
 * have quietly undone the column choice. What the answer does carry is the name — enough to tell two
 * rows of the queue apart, and enough for the operator to go and read the account through
 * `/users/:id`, which is the route that is allowed to say what an address is.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const fullNameFor = (name: string) =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)} Person ${RUN}`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();

const accountIds = new Map<string, string>();
const tokens = new Map<string, string>();

/** Row ids this file filed, keyed by the story each one is the record of, so a filter's expected
 * answer can be named rather than counted. */
const outboxIds = new Map<string, string>();

async function register(name: string, role: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email: emailFor(name),
      password: PASSWORD,
      fullName: fullNameFor(name),
      role,
    })
    .expect(201);
  const id = res.body.user.id as string;
  accountIds.set(name, id);
  return id;
}

async function bearer(name: string): Promise<string> {
  const cached = tokens.get(name);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  const token = res.body.accessToken as string;
  tokens.set(name, token);
  return token;
}

const accountId = (name: string): string => {
  const id = accountIds.get(name);
  if (!id) throw new Error(`No account named ${name} was registered by this file.`);
  return id;
};

/** One read of the queue. With no name given it is the call an anonymous visitor makes, which is the
 * case worth separating from a signed-in person who is not allowed. */
async function list(
  who?: string,
  query?: Record<string, string | number>,
): Promise<request.Response> {
  // The token is settled before the request object exists — signing in inside the chain would be a
  // second supertest request on the same ephemeral listener, and the inner one closes it.
  const token = who === undefined ? undefined : await bearer(who);
  const call = request(app.getHttpServer()).get('/api/v1/outbox');
  const authorised = token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  return authorised.query(query ?? {});
}

const body = (res: request.Response): OutboxListResponse => res.body as OutboxListResponse;
const ids = (res: request.Response): string[] => body(res).items.map((entry) => entry.id);

async function roleId(code: string): Promise<string> {
  const role = await prisma.lkpValue.findFirstOrThrow({
    where: { code, type: { code: 'UserRole' } },
    select: { id: true },
  });
  return role.id;
}

/** File a row the way a send decision files one: through the queue, inside a transaction, with the
 * news as it stands. A hand-inserted row would let this file pass on a shape no writer makes. */
async function file(
  event: BookingMailEvent | EnrollmentMailEvent,
  recipient: string,
): Promise<string> {
  const party = (name: string) => ({
    id: accountId(name),
    fullName: fullNameFor(name),
    timezone: 'Asia/Kolkata',
  });
  const teacher = party('author');
  const student = party(recipient);
  const course = { id: randomUUID(), title: `Reading the queue ${RUN}` };
  const queue = app.get(MailQueue);

  const isBooking = (BOOKING_MAIL_EVENTS as readonly string[]).includes(event);
  const row = await prisma.$transaction((tx) =>
    isBooking
      ? queue.aboutBooking(tx, event as BookingMailEvent, {
          course,
          student,
          teacher,
          startsAt: new Date('2026-10-05T09:00:00.000Z'),
        })
      : queue.aboutEnrollment(tx, event as EnrollmentMailEvent, {
          course: { ...course, teacherName: teacher.fullName },
          student: { id: student.id },
        }),
  );
  outboxIds.set(event, row.id);
  return row.id;
}

/** Move a row to the state the sweep would have left it in.
 *
 * The transitions are not being tested here — 6e owns them and proved them beside a transport — and
 * calling the sweep to set up this file would need a mail host. So the fixture writes the columns
 * the sweep writes and the read is asked only what it reports about them. */
async function settle(
  id: string,
  data: { status: string; attempts?: number; sentAt?: Date; failureReason?: string },
): Promise<void> {
  await prisma.mailOutbox.update({ where: { id }, data });
}

describe('GET /api/v1/outbox', () => {
  let sentId = '';
  let failedId = '';
  let droppedId = '';

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    // This file is not testing the sweep, and a sweep running over its fixtures would answer a
    // different question: on a box with no transport it takes the queued rows and drops them, which
    // is exactly what the two rows still waiting here exist to be an example of.
    app.get(SchedulerRegistry).deleteCronJob('mail-outbox-delivery');

    await register('author', ROLE_CODES.TEACHER);
    await register('learner', ROLE_CODES.STUDENT);
    await register('outsider', ROLE_CODES.STUDENT);
    // `ops` is not a role the sign-up form hands out, so the account is issued it the way the
    // platform issues it.
    const opsId = await register('keeper', ROLE_CODES.TEACHER);
    await prisma.user.update({
      where: { id: opsId },
      data: { roleValueId: await roleId(ROLE_CODES.OPS) },
    });

    await bearer('keeper');

    // Five rows, in a known order: two still waiting (one for the teacher, one for the learner),
    // and three the sweep has finished with — one of each of the endings it can report.
    await file(MAIL_EVENT_CODES.BOOKING_REQUESTED, 'author');
    await file(MAIL_EVENT_CODES.ENROLLMENT_JOINED, 'learner');

    sentId = await file(MAIL_EVENT_CODES.ENROLLMENT_LEFT, 'learner');
    await settle(sentId, {
      status: MAIL_OUTBOX_STATUS_CODES.SENT,
      attempts: 1,
      sentAt: new Date('2026-09-29T10:00:00.000Z'),
    });

    failedId = await file(MAIL_EVENT_CODES.BOOKING_CANCELLED, 'author');
    await settle(failedId, {
      status: MAIL_OUTBOX_STATUS_CODES.FAILED,
      attempts: 6,
      failureReason: 'smtp 550',
    });

    droppedId = await file(MAIL_EVENT_CODES.BOOKING_EXPIRED, 'learner');
    await settle(droppedId, { status: MAIL_OUTBOX_STATUS_CODES.DROPPED });
  });

  afterAll(async () => {
    await app?.close();
    const userIds = [...accountIds.values()];
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    // Signing up and signing in are themselves recorded, so the ledger holds rows about every
    // account this file made — and it keeps an account alive underneath them.
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('answers the platform, and refuses the roles the queue is not theirs', async () => {
    expect((await list()).status).toBe(401);

    for (const who of ['learner', 'author']) {
      const res = await list(who);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(API_ERROR_CODES.FORBIDDEN);
    }

    expect((await list('keeper')).status).toBe(200);
  });

  it('answers with a page, and the count of everything the filters matched', async () => {
    const res = await list('keeper');
    expect(res.status).toBe(200);
    expect(Object.keys(body(res)).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
    expect(body(res).page).toBe(1);
    expect(body(res).pageSize).toBe(25);
    expect(body(res).total).toBeGreaterThanOrEqual(5);

    // Newest first, with `id` breaking a tie, which is the same rule the ledger answers by: a
    // screen scrolling backwards through a queue needs the rows it has already seen to stay seen.
    // Matched on row id rather than event code, because this database holds other suites' rows
    // under the same seven event codes.
    const mine = new Set(outboxIds.values());
    const shown = body(res).items.filter((entry) => mine.has(entry.id));
    expect(shown.map((entry) => entry.id).sort()).toEqual([...mine].sort());
    const created = body(res).items.map((entry) => Date.parse(entry.createdAt));
    expect([...created].sort((a, b) => b - a)).toEqual(created);
  });

  it('reports a row without carrying its letter or its reader', async () => {
    const res = await list('keeper');
    const target = body(res).items.find((entry) => entry.id === failedId);
    if (!target)
      throw new Error(`The failed row was not in the answer: ${JSON.stringify(res.body)}`);

    expect(target).toMatchObject({
      eventCode: MAIL_EVENT_CODES.BOOKING_CANCELLED,
      status: MAIL_OUTBOX_STATUS_CODES.FAILED,
      attempts: 6,
      sentAt: null,
      failureReason: 'smtp 550',
      recipient: { id: accountId('author'), fullName: fullNameFor('author') },
    });
    expect(Object.keys(target).sort()).toEqual(
      [
        'attempts',
        'createdAt',
        'eventCode',
        'eventLabel',
        'failureReason',
        'id',
        'nextAttemptAt',
        'recipient',
        'sentAt',
        'status',
        'statusLabel',
      ].sort(),
    );

    // The whole route, not just this row: a payload field would survive a per-row key check that
    // looked only at the columns, and an address would be one joined `include` away.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(emailFor('author'));
    expect(text).not.toContain(emailFor('learner'));
    expect(text).not.toContain('payload');
    expect(text).not.toContain('course_title');
  });

  it('says which ending a finished row had, and which of them is still coming', async () => {
    const res = await list('keeper');
    const byId = new Map(body(res).items.map((entry) => [entry.id, entry]));

    // `sent`, `failed` and `dropped` are three different answers to "did they get it", and the
    // screen has to be able to tell a thrown-away letter from a posted one without reading the
    // sweep's source.
    expect(byId.get(sentId)).toMatchObject({
      status: MAIL_OUTBOX_STATUS_CODES.SENT,
      statusLabel: 'Sent',
    });
    expect(byId.get(failedId)).toMatchObject({
      status: MAIL_OUTBOX_STATUS_CODES.FAILED,
      statusLabel: 'Failed',
    });
    expect(byId.get(droppedId)).toMatchObject({
      status: MAIL_OUTBOX_STATUS_CODES.DROPPED,
      statusLabel: 'Dropped',
    });

    // A delivered row's `sentAt` is the date a person asks about; a failed row's is null because no
    // send happened, whatever the retry clock says.
    expect(byId.get(sentId)?.sentAt).toBe('2026-09-29T10:00:00.000Z');
    expect(byId.get(droppedId)?.attempts).toBe(0);
  });

  it('can be asked what is still waiting, and what one person was told', async () => {
    const waiting = await list('keeper', { status: MAIL_OUTBOX_STATUS_CODES.QUEUED });
    expect(ids(waiting)).toEqual(
      expect.arrayContaining([outboxIds.get(MAIL_EVENT_CODES.BOOKING_REQUESTED)]),
    );
    expect(ids(waiting)).not.toContain(sentId);

    // Other suites leave rows in this database, so the claim is about the filter rather than about
    // which rows happen to exist: everything returned is failed, and the one this file broke is
    // among them.
    const failed = await list('keeper', { status: MAIL_OUTBOX_STATUS_CODES.FAILED });
    expect(ids(failed)).toContain(failedId);
    expect(body(failed).items.every((entry) => entry.status === 'failed')).toBe(true);

    // Whose letters, as an id rather than an address — the same reason the ledger's `actor` filter
    // is an id: the queue holds no address to search, and an operator who means a person has
    // already found them.
    const forLearner = await list('keeper', { recipient: accountId('learner') });
    expect(ids(forLearner).sort()).toEqual(
      [
        outboxIds.get(MAIL_EVENT_CODES.ENROLLMENT_JOINED),
        outboxIds.get(MAIL_EVENT_CODES.ENROLLMENT_LEFT),
        outboxIds.get(MAIL_EVENT_CODES.BOOKING_EXPIRED),
      ]
        .filter((id): id is string => id !== undefined)
        .sort(),
    );

    // The two together: the one thing that went wrong for this reader, if there had been one.
    const both = await list('keeper', {
      recipient: accountId('learner'),
      status: MAIL_OUTBOX_STATUS_CODES.FAILED,
    });
    expect(body(both).items).toEqual([]);
    expect(body(both).total).toBe(0);
  });

  it('answers a question about a stranger with an empty page rather than a 404', async () => {
    const res = await list('keeper', { recipient: randomUUID() });
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 });
  });

  it('refuses a status or a recipient that could not be asked', async () => {
    const invented = await list('keeper', { status: 'resting' });
    expect(invented.status).toBe(400);
    expect(invented.body.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);

    const notAuuid = await list('keeper', { recipient: 'everybody' });
    expect(notAuuid.status).toBe(400);
    expect(notAuuid.body.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);

    const tooMany = await list('keeper', { pageSize: 5000 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);
  });

  it('pages without repeating a row or losing one', async () => {
    const first = await list('keeper', { page: 1, pageSize: 2 });
    const second = await list('keeper', { page: 2, pageSize: 2 });

    expect(body(first).items).toHaveLength(2);
    expect(body(first).page).toBe(1);
    expect(body(first).pageSize).toBe(2);
    expect(body(first).total).toBe(body(second).total);

    const seen = [...ids(first), ...ids(second)];
    expect(new Set(seen).size).toBe(seen.length);
  });
});
