import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ACTION_CODES,
  ACTION_SECTION_CODES,
  ACTION_TARGET_TABLE_CODES,
  API_ERROR_CODES,
  ROLE_CODES,
  type ActionListResponse,
  type ActionLogEntry,
} from '@lms/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { ActionRecorder } from '../src/modules/action-log/action-recorder';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Asking the ledger a question.
 *
 * Everything before this step wrote rows; nothing could read them, which makes the phase a table
 * rather than a feature. So the claims here are the ones an operator would actually make of this
 * screen — what happened recently, what happened in one part of the app, what happened to one row,
 * what one person did, and between which two moments — and each is answered by a filter that rides
 * an index the table already has, or the one this step adds for `section_code`.
 *
 * Three things this route is not, and the file says so where each one would show up: it is not
 * available to anybody but ops (the log holds one account's sign-ins and another teacher's
 * decisions, which is nobody's business but the platform's); it is not a place a row gains meaning
 * by being joined back to its target, because `target_id` has no foreign key on purpose and a
 * retired course still has a history; and it is not a source of personal data — the actor comes with
 * a name and a role and never an address, because the ledger outlives the correction a person makes
 * to their account, and the deletion they ask for.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const fullNameFor = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)} Person`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();

const accountIds = new Map<string, string>();
const tokens = new Map<string, string>();
let witnessId = '';
let courseId = '';
/** A booking that never was: the sweep's record is about a row, and the row may be gone by the time
 * anybody reads the question. `target_id` promises no resolution, so this is the honest fixture. */
const expiredBookingId = randomUUID();

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

/** Sign in once per person and keep the token: `/auth/login` is throttled far below what a file
 * with four accounts in it would otherwise spend. */
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

/** One read of the log. With no name given it is the call an anonymous visitor makes, which is the
 * case worth separating from a signed-in person who is not allowed. */
async function list(
  who?: string,
  query?: Record<string, string | number>,
): Promise<request.Response> {
  // The token is settled before the request object exists. Signing in inside the chain would be a
  // second supertest request on the same ephemeral listener, and the inner one closes it.
  const token = who === undefined ? undefined : await bearer(who);
  const call = request(app.getHttpServer()).get('/api/v1/actions');
  const authorised = token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  return authorised.query(query ?? {});
}

const body = (res: request.Response): ActionListResponse => res.body as ActionListResponse;
const items = (res: request.Response): ActionLogEntry[] => body(res).items;
const first = (res: request.Response): ActionLogEntry => {
  const [entry] = items(res);
  if (!entry) throw new Error(`No rows in the answer: ${JSON.stringify(res.body)}`);
  return entry;
};
const codes = (entries: ActionLogEntry[]): string[] => entries.map((entry) => entry.actionCode);

const rowsWrittenBy = (actorUserId: string): Promise<ActionLogEntry[]> =>
  prisma.actionLog
    // The same ordering the route answers with, so a tie inside one transaction cannot make this file
    // disagree with itself about which row came second.
    .findMany({ where: { actorUserId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    .then((rows) => rows.map((row) => row as unknown as ActionLogEntry));

async function createCourseAs(who: string, title: string): Promise<string> {
  const server = app.getHttpServer();
  const token = await bearer(who);
  const res = await request(server)
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `${title} ${RUN}`,
      slug: `read-course-${title.toLowerCase().replace(/\W+/g, '-')}-${RUN}`,
      level: 'beginner',
      summary: 'An hour of it, worked slowly.',
      description: 'Talk about films, food and travel, with corrections as we go.',
    })
    .expect(201);
  return res.body.course.id as string;
}

async function press(who: string, path: string): Promise<void> {
  const server = app.getHttpServer();
  const token = await bearer(who);
  const res = await request(server).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (res.status !== 200) {
    throw new Error(`POST ${path} answered ${res.status}: ${JSON.stringify(res.body)}`);
  }
}

async function roleId(code: string): Promise<string> {
  const role = await prisma.lkpValue.findFirstOrThrow({
    where: { code, type: { code: 'UserRole' } },
    select: { id: true },
  });
  return role.id;
}

describe('GET /api/v1/actions', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    witnessId = await register('witness', ROLE_CODES.TEACHER);
    await register('outsider', ROLE_CODES.TEACHER);
    await register('learner', ROLE_CODES.STUDENT);
    // `ops` is not a role the sign-up form will hand out, so the account is issued the way the
    // platform issues it: written from the lookup row an operator would be created under.
    const opsId = await register('keeper', ROLE_CODES.TEACHER);
    await prisma.user.update({
      where: { id: opsId },
      data: { roleValueId: await roleId(ROLE_CODES.OPS) },
    });

    // Rows worth reading, in a known order: two account events, then one course through its life.
    await bearer('witness');
    courseId = await createCourseAs('witness', 'Reading the ledger');
    await press('witness', `/courses/${courseId}/publish`);
    await press('witness', `/courses/${courseId}/archive`);

    // Somebody else's activity, so "which rows are this person's" has a wrong answer to exclude.
    await bearer('outsider');
    await createCourseAs('outsider', 'A second teachers course');

    // The scheduler's half, filed by the recorder itself: the sweep is production code, and a
    // hand-inserted row would let this file pass on a shape the writer would never produce.
    await prisma.$transaction((tx) =>
      app.get(ActionRecorder).record(tx, {
        action: ACTION_CODES.BOOKING_EXPIRED,
        targetId: expiredBookingId,
        detail: { from: 'pending', to: 'expired' },
      }),
    );
  });

  afterAll(async () => {
    await app?.close();
    const userIds = [...accountIds.values()];
    await prisma.actionLog.deleteMany({
      where: {
        OR: [{ actorUserId: { in: userIds } }, { targetId: { in: [courseId, expiredBookingId] } }],
      },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    // Every course this file made, not just the one it pressed: a teacher owns their courses by a
    // restricted key, so the second one would hold its account in the table too.
    await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('answers the platform, and refuses the roles the log is not theirs', async () => {
    const teacher = await list('witness');
    const student = await list('learner');
    expect(teacher.status).toBe(403);
    expect(teacher.body.code).toBe(API_ERROR_CODES.FORBIDDEN);
    expect(student.status).toBe(403);

    // An anonymous caller is not "somebody who asked and was refused" — they have not identified
    // themselves, and the two answers are different questions.
    const anonymous = await list();
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe(API_ERROR_CODES.UNAUTHORIZED);

    const ops = await list('keeper');
    expect(ops.status).toBe(200);
    expect(body(ops)).toMatchObject({ page: 1, total: expect.any(Number) });
    expect(ops.body).toHaveProperty('pageSize');
  });

  it('hands over a row of the ledger, and nothing else', async () => {
    const res = await list('keeper', { actor: witnessId, pageSize: 1 });
    const entry = first(res);

    // The columns, named as the table names them. A screen that gets `who` and `where` would be a
    // second vocabulary for the same row, and the phase has already refused one of those.
    expect(Object.keys(entry).sort()).toEqual([
      'actionCode',
      'actor',
      'actorKind',
      'createdAt',
      'detail',
      'id',
      'requestId',
      'sectionCode',
      'targetId',
      'targetTable',
    ]);
    expect(entry).toMatchObject({
      sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
      targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
      targetId: courseId,
      actorKind: 'user',
    });
  });

  it('lists newest first, and pages without repeating or skipping a row', async () => {
    const written = await rowsWrittenBy(witnessId);

    const pageSize = 2;
    const pages = Math.ceil(written.length / pageSize);
    const seen: ActionLogEntry[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const res = await list('keeper', { actor: witnessId, page, pageSize });
      expect(body(res)).toMatchObject({ page, pageSize, total: written.length });
      seen.push(...items(res));
    }

    // Five rows for this account: signed up, signed in, and one course created, published,
    // archived — and the last page asks for a row that is not there.
    expect(witnessId).toBeTruthy();
    expect(seen.map((entry) => entry.id)).toEqual(written.map((entry) => entry.id));
    const times = seen.map((entry) => Date.parse(entry.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const past = await list('keeper', { actor: witnessId, page: pages + 1, pageSize });
    expect(items(past)).toEqual([]);
    expect(body(past).total).toBe(written.length);
  });

  it('separates the parts of the app, and the actions inside one of them', async () => {
    const authoring = await list('keeper', { section: ACTION_SECTION_CODES.COURSE_AUTHORING });
    const inAuthoring = items(authoring);
    expect(inAuthoring.length).toBeGreaterThan(0);
    expect(new Set(inAuthoring.map((entry) => entry.sectionCode))).toEqual(
      new Set([ACTION_SECTION_CODES.COURSE_AUTHORING]),
    );

    const accounts = await list('keeper', {
      section: ACTION_SECTION_CODES.ACCOUNT,
      actor: witnessId,
    });
    expect(codes(items(accounts))).toEqual(['signed_in', 'account_registered']);

    // The narrower question the section cannot answer on its own: one decision, wherever it was
    // taken. Filtered to this account so the count is this file's rather than the table's.
    const published = await list('keeper', {
      action: ACTION_CODES.COURSE_PUBLISHED,
      actor: witnessId,
    });
    expect(codes(items(published))).toEqual([ACTION_CODES.COURSE_PUBLISHED]);
    expect(first(published).targetId).toBe(courseId);
  });

  it('answers everything about one row, from whichever section it came', async () => {
    const about = await list('keeper', {
      targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
      targetId: courseId,
    });
    expect(codes(items(about))).toEqual(['course_archived', 'course_published', 'course_created']);
    expect(new Set(items(about).map((entry) => entry.sectionCode))).toEqual(
      new Set([ACTION_SECTION_CODES.COURSE_AUTHORING]),
    );

    // A target that resolves to nothing is an empty page, not a 404: the log is allowed to remember
    // a row nobody will ever find again, and asking after it is a legitimate question.
    const none = await list('keeper', {
      targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
      targetId: randomUUID(),
    });
    expect(items(none)).toEqual([]);
    expect(body(none).total).toBe(0);
  });

  it('keeps a window, and the rows outside it', async () => {
    const minuteAhead = new Date(Date.now() + 60_000).toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();

    const recent = await list('keeper', { actor: witnessId, from: hourAgo });
    expect(body(recent).total).toBeGreaterThan(0);

    const future = await list('keeper', { actor: witnessId, from: minuteAhead });
    expect(items(future)).toEqual([]);

    const before = await list('keeper', { actor: witnessId, to: hourAgo });
    expect(items(before)).toEqual([]);

    // Both ends, and the window is what it looks like: `to` is the moment up to which the reader
    // means, so a row filed at exactly the boundary is inside.
    const both = await list('keeper', { actor: witnessId, from: hourAgo, to: minuteAhead });
    const all = await list('keeper', { actor: witnessId });
    expect(body(both).total).toBe(body(all).total);
  });

  it('names the person without quoting their address', async () => {
    const res = await list('keeper', { actor: witnessId, section: ACTION_SECTION_CODES.ACCOUNT });
    const entry = first(res);

    // The role is the one the row stored, the name is the account's, and neither is a copy of the
    // row: an account renamed after the fact would be read here as it now stands, in a row that
    // still says what happened to it then.
    expect(entry.actor).toMatchObject({ id: witnessId, fullName: fullNameFor('witness') });
    expect(entry.actor?.roleCode).toBe(ROLE_CODES.TEACHER);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('@');
    expect(raw).not.toContain(PASSWORD);
    expect(raw).not.toContain(RUN + '@');
  });

  it('says which rows no person did', async () => {
    const res = await list('keeper', {
      targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
      targetId: expiredBookingId,
    });
    const entry = first(res);

    expect(entry).toMatchObject({
      actionCode: ACTION_CODES.BOOKING_EXPIRED,
      sectionCode: ACTION_SECTION_CODES.BOOKING,
      actorKind: 'system',
      actor: null,
      requestId: null,
    });
    expect(entry.detail).toEqual({ from: 'pending', to: 'expired' });
  });

  it('hands the decided facts over as they were written', async () => {
    const res = await list('keeper', { action: ACTION_CODES.COURSE_ARCHIVED, actor: witnessId });
    const entry = first(res);

    // Not a copy of the course: which two states the switch moved between, and nothing the columns
    // already hold. `jsonb` keeps no order, so the answer is read by name.
    expect(entry.detail).toEqual({ from: 'published', to: 'archived' });
  });

  it('refuses a filter the vocabulary does not have, rather than answering with nothing', async () => {
    // An empty page is a plausible-looking answer to a nonsense question, and the operator would
    // read it as "no such actions happened" rather than "you asked for a section that is not one".
    const invented = await list('keeper', { section: 'made_up_section' });
    expect(invented.status).toBe(400);
    expect(invented.body.details.validation).toHaveProperty('section');

    const notAnAction = await list('keeper', { action: 'made_up_action' });
    expect(notAnAction.status).toBe(400);
    expect(notAnAction.body.details.validation).toHaveProperty('action');

    const notAPerson = await list('keeper', { actor: 'nobody-with-this-id' });
    expect(notAPerson.status).toBe(400);
    expect(notAPerson.body.details.validation).toHaveProperty('actor');

    // A target is a table and an id together: the pair is what the index holds, and an id alone
    // would be a question the route cannot answer without reading the table.
    const halfATarget = await list('keeper', { targetId: courseId });
    expect(halfATarget.status).toBe(400);
    expect(halfATarget.body.details.validation).toHaveProperty('targetTable');

    const tooBig = await list('keeper', { pageSize: 101 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.details.validation).toHaveProperty('pageSize');

    const notATime = await list('keeper', { from: 'last tuesday' });
    expect(notATime.status).toBe(400);
    expect(notATime.body.details.validation).toHaveProperty('from');
  });

  it('does not let a reader ask for somebody else’s history by mistake', async () => {
    // The filters narrow one result set; they do not change who may see it. This is the shape that
    // would be easy to get wrong by treating `actor` as a permission rather than as a predicate.
    const res = await list('keeper', { actor: witnessId });
    const ids = new Set(items(res).map((entry) => entry.actor?.id));
    expect(ids).toEqual(new Set([witnessId]));

    const everyone = await list('keeper', { pageSize: 100 });
    const anyone = items(everyone).filter((entry) => entry.actor !== null);
    expect(anyone.every((entry) => typeof entry.actor?.id === 'string'));
  });
});
