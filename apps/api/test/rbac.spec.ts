import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { API_ERROR_CODES, PERMISSION_CODES, ROLE_CODES } from '@lms/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { collectEndpoints } from '../src/docs/endpoint-reference';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * What a request is allowed to do is answered by a capability the account holds, not by the role's
 * name at the door.
 *
 * The three roles are still the rows a caller can have, and today every route a teacher may call is
 * still exactly the routes a teacher may call — this changes the shape of the answer, not the answer.
 * It is worth having anyway for three reasons, and each has a test here:
 *
 * - **One place lists what each account can do.** `ROLE_PERMISSIONS` in `@lms/shared` is the whole
 *   policy, so a fourth kind of account is one entry there rather than sixty route files read again
 *   looking for the ones that say `teacher`.
 * - **A route states what it needs.** `@Permissions('course.author')` says something a role name
 *   does not: which decision the route makes. The reference publishes it, so a caller reading the
 *   API page learns the capability behind an address.
 * - **A mistake fails closed.** A capability no role holds refuses everybody, and a capability the
 *   catalog does not know refuses everybody too. Both are caught by the completeness test rather
 *   than by somebody discovering a door that never opens.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();
const tokens = new Map<string, string>();

async function register(name: string, role: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: `Rbac ${name} ${RUN}`, role })
    .expect(201);
  return res.body.user.id as string;
}

/** One sign-in per person: `/auth/login` is throttled far below what a file this size would spend. */
async function bearer(name: string): Promise<string> {
  const cached = tokens.get(name);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  tokens.set(name, res.body.accessToken as string);
  return tokens.get(name) as string;
}

async function as(
  who: string,
  method: 'get' | 'post',
  path: string,
  payload?: Record<string, unknown>,
): Promise<request.Response> {
  const token = await bearer(who);
  const server = app.getHttpServer();
  const call =
    method === 'get'
      ? request(server).get(`/api/v1${path}`)
      : request(server)
          .post(`/api/v1${path}`)
          .send(payload ?? {});
  return call.set('Authorization', `Bearer ${token}`);
}

async function lookupId(code: string, typeCode: string): Promise<string> {
  const value = await prisma.lkpValue.findFirstOrThrow({
    where: { code, type: { code: typeCode } },
  });
  return value.id;
}

const findEndpoint = (method: string, path: string) => {
  const record = collectEndpoints().find((entry) => entry.method === method && entry.path === path);
  if (!record) throw new Error(`No ${method} ${path} in the reference`);
  return record;
};

describe('the permission guard', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    await register('learner', ROLE_CODES.STUDENT);
    await register('author', ROLE_CODES.TEACHER);
    const operator = await register('operator', ROLE_CODES.TEACHER);
    // The desk's own role is not self-registerable (§8), so the fixture puts it on with the same
    // write the accounts screen uses.
    await prisma.user.update({
      where: { id: operator },
      data: { roleValueId: await lookupId(ROLE_CODES.OPS, 'UserRole') },
    });
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('refuses a capability the account does not hold, whoever the caller is', async () => {
    const refusals: [string, 'get' | 'post', string][] = [
      ['learner', 'get', '/users'],
      ['learner', 'get', '/actions'],
      ['learner', 'get', '/outbox'],
      ['learner', 'post', '/courses'],
      ['learner', 'get', '/availability/rules'],
      ['learner', 'get', '/classes/teaching'],
      ['author', 'get', '/users'],
      ['author', 'get', '/actions'],
      ['author', 'get', '/enrollments'],
      ['author', 'get', '/classes/learning'],
      ['author', 'post', '/enrollments'],
      ['operator', 'get', '/courses'],
      ['operator', 'get', '/availability/rules'],
      ['operator', 'get', '/bookings/requests'],
      ['operator', 'get', '/enrollments'],
    ];

    for (const [who, method, path] of refusals) {
      const res = await as(who, method, path);
      expect(res.status, `${who} reached ${method.toUpperCase()} ${path}`).toBe(403);
    }
  });

  it('refuses at the door, before the row a route names is even looked up', async () => {
    // A teacher poking at another teacher's roster gets the same 403 as their own, not the 404 the
    // ownership rule would answer. The capability is checked first, so an id says nothing either way.
    const res = await as('learner', 'get', '/courses/does-not-exist/roster');
    expect(res.status).toBe(403);
  });

  it('answers a refusal without naming what the caller is missing', async () => {
    const res = await as('learner', 'get', '/users');

    expect(res.body.code).toBe(API_ERROR_CODES.FORBIDDEN);
    expect(JSON.stringify(res.body)).not.toContain('course.author');
    expect(JSON.stringify(res.body)).not.toContain('account.manage');
  });

  it('lets through every route whose capability the account does hold', async () => {
    const allowed: [string, 'get' | 'post', string][] = [
      ['author', 'get', '/courses'],
      ['author', 'get', '/availability/rules'],
      ['author', 'get', '/classes/teaching'],
      ['author', 'get', '/teacher/profile'],
      ['learner', 'get', '/enrollments'],
      ['learner', 'get', '/classes/learning'],
      ['learner', 'get', '/bookings'],
      ['operator', 'get', '/users'],
      ['operator', 'get', '/actions'],
      ['operator', 'get', '/outbox'],
    ];

    for (const [who, method, path] of allowed) {
      const res = await as(who, method, path);
      expect(res.status, `${who} blocked from ${method.toUpperCase()} ${path}`).toBe(200);
    }
  });

  it('publishes the capability behind an address in the reference', () => {
    expect(findEndpoint('GET', '/api/v1/users').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.ACCOUNT_MANAGE],
      roles: ['ops'],
    });
    expect(findEndpoint('POST', '/api/v1/bookings/:id/confirm').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.BOOKING_ANSWER],
      roles: ['teacher'],
    });
    expect(findEndpoint('GET', '/api/v1/classes/learning').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.CLASS_ATTEND],
      roles: ['student'],
    });
    // The four routes under the accounts desk inherit the class-wide capability, which is what the
    // guard actually applies — a reader has to see it on every line, not only on the first.
    expect(findEndpoint('PATCH', '/api/v1/users/:id/role').access.permissions).toEqual([
      PERMISSION_CODES.ACCOUNT_MANAGE,
    ]);
  });

  it('leaves the routes that answer to anybody signed in saying so', () => {
    // Two addresses in the platform name no capability because the row they read decides instead:
    // one's own session, and the room of a class the caller holds a place in. A third route joining
    // this list is a decision, not an oversight, so it is written out here.
    const unpermissioned = collectEndpoints()
      .filter((entry) => entry.access.kind === 'session' && entry.access.permissions.length === 0)
      .map((entry) => `${entry.method} ${entry.path}`)
      .sort();

    expect(unpermissioned).toEqual(['GET /api/v1/auth/me', 'POST /api/v1/bookings/:id/room']);
  });

  it('names no capability the catalog does not carry, and none that nobody holds', () => {
    const known = Object.values(PERMISSION_CODES) as string[];
    const used = new Set<string>();

    for (const entry of collectEndpoints()) {
      for (const code of entry.access.permissions) {
        expect(
          known,
          `${entry.method} ${entry.path} names ${code}, which is not a capability`,
        ).toContain(code);
        used.add(code);
      }
    }

    for (const code of known) {
      expect([...used], `${code} is a capability no route asks for`).toContain(code);
    }
  });
});
