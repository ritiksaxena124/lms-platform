import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ACTION_CODES,
  API_ERROR_CODES,
  ROLE_CODES,
  type OpsAccount,
  type OpsAccountListResponse,
} from '@lms/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The accounts screen, seen from the API side: five questions and two decisions.
 *
 * Phase 7 built the ledger and a door into it that only ops may open, and then nothing could issue
 * the role — `ROLE_CODES.OPS` was a row in a lookup table that no request in the system could put on
 * an account except by hand. So this is the surface that makes the platform's own admin reachable,
 * which is why the two writes are the guarded half of the file rather than the reads: an address
 * search and a page of accounts are ordinary, while disabling a person and issuing an operator are
 * the two things an account cannot undo for itself.
 *
 * Three rules hold this together, and each gets its own test:
 *
 * - **The role is read from the row, now.** A promotion works on the next request of a session that
 *   was signed in before it, and a revocation ends one. `JwtAuthGuard` already asked the account
 *   rather than the token; these two routes are where that stops being a detail.
 * - **An operator cannot move their own account.** Not its status, not its role. The alternative is
 *   a platform locking itself out of its own admin in one click, with no support desk standing
 *   behind it and no way back in except database access.
 * - **A write that changes nothing writes nothing.** Asking for the status an account already has is
 *   a mistake to report, not a no-op to record, and the ledger stays out of it.
 *
 * Disabling touches one column and no token. The guard loads the account on every authenticated
 * request and refuses a disabled one, and `/auth/refresh` asks the same question, so an account that
 * goes dark is out of the platform inside one request without retiring a single session row — and
 * switching it back on needs nothing undone.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
// The run id goes into the name as well as the address, because a name search that means "the
// account this file made" has to be able to say so: other suites seed accounts called
// `Author Person` too, and a shared database would otherwise answer with all of them.
const fullNameFor = (name: string) =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)} Person ${RUN}`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();

const accountIds = new Map<string, string>();
const tokens = new Map<string, string>();
let keeperId = '';
let victimId = '';

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
 * with six accounts and two roles per account would otherwise spend. */
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

/** Drop a cached token so the next call signs in again — the way to ask whether a role change or a
 * disabled account is answered from the row rather than from anything the session carries. */
function forgetToken(name: string): void {
  tokens.delete(name);
}

async function as(
  who: string,
  method: 'get' | 'patch',
  path: string,
  payload?: Record<string, unknown>,
): Promise<request.Response> {
  // Settled before the request object exists: signing in inside the chain would be a second
  // supertest request on one ephemeral listener, and the inner one closes it.
  const token = await bearer(who);
  const server = app.getHttpServer();
  const call =
    method === 'get'
      ? request(server)
          .get(`/api/v1${path}`)
          .query(payload ?? {})
      : request(server).patch(`/api/v1${path}`).send(payload);
  return call.set('Authorization', `Bearer ${token}`);
}

/** Anonymous, which is a different refusal from a signed-in person who is not allowed. */
function anonymous(method: 'get' | 'patch', path: string): request.Test {
  const server = app.getHttpServer();
  return method === 'get'
    ? request(server).get(`/api/v1${path}`)
    : request(server).patch(`/api/v1${path}`);
}

const listed = (res: request.Response): OpsAccount[] => (res.body as OpsAccountListResponse).items;
const find = (res: request.Response, name: string): OpsAccount => {
  const account = listed(res).find((row) => row.id === accountIds.get(name));
  if (!account) throw new Error(`No ${name} in the answer: ${JSON.stringify(res.body)}`);
  return account;
};

/** Every row this file filed about one account, newest first, read straight from the table. An
 * action is passed when the claim is about a decision rather than about the account's whole history,
 * because signing in during setup filed rows about the same people. */
const recordsAbout = (targetId: string, action?: string) =>
  prisma.actionLog.findMany({
    where: { targetId, ...(action ? { actionCode: action } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

/** The newest row filed about one account, or a failure that names what was missing — the two
 * states a ledger read can be in, and a test should not read `undefined` as an empty record. */
const newestRecord = async (targetId: string, action: string) => {
  const [row] = await recordsAbout(targetId, action);
  if (!row) throw new Error(`No ${action} record about ${targetId}`);
  return row;
};

const accountId = (name: string): string => {
  const id = accountIds.get(name);
  if (!id) throw new Error(`No account called ${name} was registered by this file`);
  return id;
};
async function lookupId(code: string, typeCode: string): Promise<string> {
  const value = await prisma.lkpValue.findFirstOrThrow({
    where: { code, type: { code: typeCode } },
    select: { id: true },
  });
  return value.id;
}

describe('the accounts surface', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    await register('author', ROLE_CODES.TEACHER);
    await register('learner', ROLE_CODES.STUDENT);
    victimId = await register('victim', ROLE_CODES.STUDENT);
    // The operator this file signs in as, made by hand because the sign-up form will not issue the
    // role — and that refusal is the thing the rest of the file exists to replace.
    keeperId = await register('keeper', ROLE_CODES.TEACHER);
    await prisma.user.update({
      where: { id: keeperId },
      data: { roleValueId: await lookupId(ROLE_CODES.OPS, 'UserRole') },
    });

    // Every account here is resolved once, so a list test has a stable population to count.
    await bearer('keeper');
    await bearer('author');
    await bearer('learner');
    await bearer('victim');
  });

  afterAll(async () => {
    await app?.close();
    const userIds = [...accountIds.values()];
    await prisma.actionLog.deleteMany({
      where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }] },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('GET /api/v1/users', () => {
    it('is the ops door, and nobody else’s', async () => {
      await expect(anonymous('get', '/users').query({ q: RUN })).resolves.toMatchObject({
        status: 401,
        body: { code: API_ERROR_CODES.UNAUTHORIZED },
      });
      for (const who of ['learner', 'author']) {
        const res = await as(who, 'get', '/users');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe(API_ERROR_CODES.FORBIDDEN);
      }
      const res = await as('keeper', 'get', '/users');
      expect(res.status).toBe(200);
    });

    it('answers a page, and the total the same filters matched', async () => {
      const res = await as('keeper', 'get', '/users', { q: RUN });
      expect(res.status).toBe(200);

      const body = res.body as OpsAccountListResponse;
      // Everything this file made, and nothing anybody else's: `q` is the only honest way to scope a
      // claim to one suite when every spec shares one database.
      expect(body.total).toBe(listed(res).length);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(25);
      expect(
        listed(res)
          .map((account) => account.id)
          .sort(),
      ).toEqual([...accountIds.values()].sort());

      // The address belongs on an account screen — an operator finding a person by email is the
      // reason this read may answer with one when the ledger may not. The labels come from the
      // lookup rows, so what a screen prints is what Ops renamed them to.
      expect(find(res, 'learner')).toMatchObject({
        email: emailFor('learner'),
        fullName: fullNameFor('learner'),
        roleCode: ROLE_CODES.STUDENT,
        roleLabel: 'Student',
        statusCode: 'active',
        statusLabel: 'Active',
      });
      expect(find(res, 'keeper').roleCode).toBe(ROLE_CODES.OPS);
      expect(find(res, 'keeper').lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(find(res, 'learner').createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('finds an account by name or by address, whichever case was typed', async () => {
      const byAddress = await as('keeper', 'get', '/users', { q: emailFor('author') });
      expect(listed(byAddress).map((account) => account.id)).toEqual([accountIds.get('author')]);

      const cased = await as('keeper', 'get', '/users', { q: `AUTHOR.${RUN}` });
      expect(listed(cased).map((account) => account.id)).toEqual([accountIds.get('author')]);

      const byName = await as('keeper', 'get', '/users', { q: fullNameFor('author') });
      expect(listed(byName).map((account) => account.id)).toEqual([accountIds.get('author')]);
    });

    it('narrows to one role, or to one status', async () => {
      const students = await as('keeper', 'get', '/users', { q: RUN, role: ROLE_CODES.STUDENT });
      expect(
        listed(students)
          .map((account) => account.id)
          .sort(),
      ).toEqual([accountIds.get('learner'), victimId].sort());

      const ops = await as('keeper', 'get', '/users', { q: RUN, role: ROLE_CODES.OPS });
      expect(listed(ops).map((account) => account.id)).toEqual([keeperId]);

      const active = await as('keeper', 'get', '/users', { q: RUN, status: 'active' });
      expect(active.body.total).toBe(4);

      const disabled = await as('keeper', 'get', '/users', { q: RUN, status: 'disabled' });
      expect(listed(disabled)).toEqual([]);
    });

    it('pages without repeating or dropping an account', async () => {
      const one = await as('keeper', 'get', '/users', { q: RUN, pageSize: 2 });
      const two = await as('keeper', 'get', '/users', { q: RUN, pageSize: 2, page: 2 });

      // Newest first, which is the order an operator scrolling a registration list expects.
      const dates = listed(one).map((account) => Date.parse(account.createdAt));
      expect(dates).toEqual([...dates].sort((a, b) => b - a));

      const seen = [...listed(one), ...listed(two)].map((account) => account.id);
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
      expect((one.body as OpsAccountListResponse).total).toBe(4);
      expect(two.body.page).toBe(2);
    });

    it('refuses a code that is not in the vocabulary, and a fragment too short to search', async () => {
      const role = await as('keeper', 'get', '/users', { role: 'complaint' });
      expect(role.status).toBe(400);
      expect(role.body.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);

      const status = await as('keeper', 'get', '/users', { status: 'resting' });
      expect(status.status).toBe(400);

      const short = await as('keeper', 'get', '/users', { q: 'x' });
      expect(short.status).toBe(400);

      const page = await as('keeper', 'get', '/users', { pageSize: 5_000 });
      expect(page.status).toBe(400);
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('reads one account, with what it is holding', async () => {
      const res = await as('keeper', 'get', `/users/${accountIds.get('author')}`);
      expect(res.status).toBe(200);
      expect(res.body.account).toMatchObject({
        id: accountIds.get('author'),
        email: emailFor('author'),
        fullName: fullNameFor('author'),
        roleCode: ROLE_CODES.TEACHER,
        statusCode: 'active',
      });
      // The numbers an operator needs before pressing either button: what would go quiet, and how
      // many sessions are about to find themselves refused.
      expect(res.body.account.counts).toEqual({
        courses: 0,
        enrollments: 0,
        bookingsAsStudent: 0,
        bookingsAsTeacher: 0,
        activeSessions: expect.any(Number),
      });

      const own = await as('author', 'get', `/users/${accountIds.get('author')}`);
      expect(own.status).toBe(403);
    });

    it('says no account for an id that is not one', async () => {
      const missing = await as('keeper', 'get', `/users/${randomUUID()}`);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe(API_ERROR_CODES.NOT_FOUND);

      // The same answer the rest of the API gives for an address that cannot be a row: a bad id is
      // not a request worth reporting as a typo, since nobody outside the platform can tell whether
      // one was meant as an id or as a slug.
      const malformed = await as('keeper', 'get', '/users/not-a-uuid');
      expect(malformed.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/users/:id/status', () => {
    it('disables an account, and the account feels it on its next request', async () => {
      const res = await as('keeper', 'patch', `/users/${victimId}/status`, { status: 'disabled' });
      expect(res.status).toBe(200);
      expect(res.body.account).toMatchObject({ id: victimId, statusCode: 'disabled' });

      // Disabled is a status, not a deletion: the row, its name and its history all stay.
      const row = await prisma.user.findUniqueOrThrow({ where: { id: victimId } });
      expect(row.isActive).toBe(true);

      const refused = await as('victim', 'get', '/auth/me');
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe(API_ERROR_CODES.ACCOUNT_DISABLED);

      const record = await newestRecord(victimId, ACTION_CODES.ACCOUNT_STATUS_CHANGED);
      expect(record).toMatchObject({
        actionCode: ACTION_CODES.ACCOUNT_STATUS_CHANGED,
        actorUserId: keeperId,
        actorRoleCode: ROLE_CODES.OPS,
        targetTable: 'users',
        detail: { from: 'active', to: 'disabled' },
      });
      // Not a copy of the row: the two states the switch moved between, which is the whole decision.
      expect(record.detail).not.toHaveProperty('email');
    });

    it('gives the account back, and the ledger says which way each press went', async () => {
      const res = await as('keeper', 'patch', `/users/${victimId}/status`, { status: 'active' });
      expect(res.status).toBe(200);
      expect(res.body.account.statusCode).toBe('active');

      const restored = await as('victim', 'get', '/auth/me');
      expect(restored.status).toBe(200);

      const latest = await newestRecord(victimId, ACTION_CODES.ACCOUNT_STATUS_CHANGED);
      expect(latest.detail).toEqual({ from: 'disabled', to: 'active' });
      const both = await recordsAbout(victimId, ACTION_CODES.ACCOUNT_STATUS_CHANGED);
      expect(both.filter((row) => row.actorUserId === keeperId)).toHaveLength(2);
    });

    it('writes nothing when the answer was already the ask', async () => {
      const before = await recordsAbout(victimId, ACTION_CODES.ACCOUNT_STATUS_CHANGED);
      const res = await as('keeper', 'patch', `/users/${victimId}/status`, { status: 'active' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(API_ERROR_CODES.CONFLICT);

      const after = await recordsAbout(victimId, ACTION_CODES.ACCOUNT_STATUS_CHANGED);
      expect(after).toHaveLength(before.length);
    });

    it('will not let an operator close their own door', async () => {
      const res = await as('keeper', 'patch', `/users/${keeperId}/status`, { status: 'disabled' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(API_ERROR_CODES.FORBIDDEN);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: keeperId } });
      expect(row.statusValueId).toBe(await lookupId('active', 'AccountStatus'));
      expect(await recordsAbout(keeperId, ACTION_CODES.ACCOUNT_STATUS_CHANGED)).toEqual([]);
    });

    it('refuses a status the platform does not have, and an account it does not', async () => {
      const unknown = await as('keeper', 'patch', `/users/${victimId}/status`, {
        status: 'suspended',
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body.code).toBe(API_ERROR_CODES.VALIDATION_FAILED);

      const missing = await as('keeper', 'patch', `/users/${randomUUID()}/status`, {
        status: 'disabled',
      });
      expect(missing.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/users/:id/role', () => {
    it('issues the ops role, and the new operator opens the ledger with it', async () => {
      const author = accountId('author');
      const res = await as('keeper', 'patch', `/users/${author}/role`, {
        role: ROLE_CODES.OPS,
      });
      expect(res.status).toBe(200);
      expect(res.body.account).toMatchObject({ roleCode: ROLE_CODES.OPS, roleLabel: 'Operations' });

      // The session that was signed in while this account was a teacher is the proof: the guard
      // asks the row, so a promotion is live on the next request and not at the next sign-in.
      const opened = await as('author', 'get', '/actions');
      expect(opened.status).toBe(200);

      const record = await newestRecord(author, ACTION_CODES.ACCOUNT_ROLE_CHANGED);
      expect(record).toMatchObject({
        actionCode: ACTION_CODES.ACCOUNT_ROLE_CHANGED,
        actorUserId: keeperId,
        actorRoleCode: ROLE_CODES.OPS,
        detail: { from: ROLE_CODES.TEACHER, to: ROLE_CODES.OPS },
      });
    });

    it('revokes it, and the former operator is back outside', async () => {
      const res = await as('keeper', 'patch', `/users/${accountId('author')}/role`, {
        role: ROLE_CODES.TEACHER,
      });
      expect(res.status).toBe(200);
      expect(res.body.account.roleCode).toBe(ROLE_CODES.TEACHER);

      forgetToken('author');
      const refused = await as('author', 'get', '/actions');
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe(API_ERROR_CODES.FORBIDDEN);
    });

    it('will not let an operator revoke their own role', async () => {
      const res = await as('keeper', 'patch', `/users/${keeperId}/role`, {
        role: ROLE_CODES.TEACHER,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(API_ERROR_CODES.FORBIDDEN);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: keeperId } });
      expect(row.roleValueId).toBe(await lookupId(ROLE_CODES.OPS, 'UserRole'));
    });

    it('only moves accounts across the ops door', async () => {
      const learner = accountId('learner');
      const res = await as('keeper', 'patch', `/users/${learner}/role`, {
        role: ROLE_CODES.TEACHER,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(API_ERROR_CODES.CONFLICT);

      const same = await as('keeper', 'patch', `/users/${learner}/role`, {
        role: ROLE_CODES.STUDENT,
      });
      expect(same.status).toBe(409);

      const unknown = await as('keeper', 'patch', `/users/${learner}/role`, {
        role: 'regulator',
      });
      expect(unknown.status).toBe(400);

      const missing = await as('keeper', 'patch', `/users/${randomUUID()}/role`, {
        role: ROLE_CODES.OPS,
      });
      expect(missing.status).toBe(404);
      expect(await recordsAbout(learner, ACTION_CODES.ACCOUNT_ROLE_CHANGED)).toEqual([]);
    });
  });
});
