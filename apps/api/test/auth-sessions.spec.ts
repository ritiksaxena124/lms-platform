import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { decode } from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A session is two tokens with two different jobs. The access token is short-lived, never
 * stored, and carries its own expiry, so a leaked one is useful for minutes. The refresh
 * token is opaque, stored hashed, lives in an HttpOnly cookie, and is replaced every time
 * it is used — so a stolen one is useful once, and using it twice says it was copied.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const REFRESH_COOKIE = 'lms_refresh';

let app: INestApplication;
const prisma = new PrismaClient();

async function lookupId(typeCode: string, code: string): Promise<string> {
  const value = await prisma.lkpValue.findFirstOrThrow({
    where: { code, type: { code: typeCode } },
  });
  return value.id;
}

async function registerAccount(name: string, role = 'teacher'): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email: emailFor(name),
      password: PASSWORD,
      fullName: 'Asha Verma',
      role,
    });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return res.body.user.id as string;
}

function login(email: string, password = PASSWORD): Promise<request.Response> {
  return request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
}

function post(path: string, cookie?: string): Promise<request.Response> {
  const call = request(app.getHttpServer()).post(`/api/v1/auth/${path}`);
  return cookie ? call.set('Cookie', cookie) : call;
}

/** The cookie and its attributes, because supertest runs no cookie jar for us. */
function rawCookie(res: request.Response, withAttributes = false): string | undefined {
  const entries = (res.headers['set-cookie'] ?? []) as string[];
  const entry = entries.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));
  return withAttributes ? entry : entry?.split(';')[0];
}

async function sessionId(name: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: emailFor(name) },
    select: { id: true },
  });
  return user.id;
}

function liveSessions(userId: string): Promise<number> {
  return prisma.refreshToken.count({ where: { userId, revokedAt: null } });
}

describe('auth sessions', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });

    await registerAccount('alice');
    await registerAccount('bob');
    await registerAccount('carol');
    await registerAccount('dave');
    // A real disable goes through the same lookup row Ops would pick, not a flag.
    await prisma.user.update({
      where: { email: emailFor('carol') },
      data: { status: { connect: { id: await lookupId('AccountStatus', 'disabled') } } },
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.refreshToken.deleteMany({ where: { user: { email: { contains: `.${RUN}@` } } } });
    await prisma.user.deleteMany({ where: { email: { contains: `.${RUN}@` } } });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns an access token and an HttpOnly refresh cookie scoped to the auth routes', async () => {
      const res = await login(emailFor('alice'));
      expect(res.status).toBe(200);

      expect(res.body.user).toMatchObject({ email: emailFor('alice'), role: 'teacher' });
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);

      const cookie = rawCookie(res, true);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      // Only the endpoints that consume it should receive it on every request.
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/i);
    });

    it('puts the account id and role in the token, and no personal data', async () => {
      const res = await login(emailFor('alice'));
      const claims = decode(res.body.accessToken) as Record<string, unknown>;

      expect(claims).toMatchObject({ sub: await sessionId('alice'), role: 'teacher' });
      expect(claims).not.toHaveProperty('email');
      expect(claims).not.toHaveProperty('password');
      expect(Number(claims.exp) - Number(claims.iat)).toBe(res.body.expiresIn);
    });

    it('answers an unknown address and a wrong password identically', async () => {
      const unknown = await login(emailFor('nobody'));
      const wrong = await login(emailFor('alice'), 'a wrong password entirely');

      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      // Anything else makes the login form a directory of who holds an account.
      expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('refuses a disabled account with the reason rather than a fake password error', async () => {
      const res = await login(emailFor('carol'));

      // The person is looking at their own account, so there is nothing to hide here —
      // and "your account was disabled" is actionable where "wrong password" is not.
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
      expect(rawCookie(res)).toBeUndefined();
    });

    it('records the sign-in so "last seen" is not guessed from createdAt', async () => {
      await login(emailFor('bob'));

      const user = await prisma.user.findFirstOrThrow({ where: { email: emailFor('bob') } });
      expect(user.lastLoginAt).not.toBeNull();
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('exchanges the cookie for a new session and retires the one it replaced', async () => {
      // Its own account: every other login is a separate device with its own live session,
      // so a shared one would make the count below meaningless.
      const erin = await registerAccount('erin');
      const first = rawCookie(await login(emailFor('erin')));
      expect(first).toBeDefined();

      const rotated = await post('refresh', first);
      expect(rotated.status).toBe(200);
      expect(rotated.body.accessToken).toContain('.');
      const second = rawCookie(rotated);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      // The lineage is one token deep: the token it replaced is retired, not kept alive
      // alongside the new one.
      expect(await liveSessions(erin)).toBe(1);

      expect((await post('refresh', first)).status).toBe(401);
    });

    it('burns every session when a retired token comes back, because it was copied', async () => {
      const bob = await sessionId('bob');
      const stolen = rawCookie(await login(emailFor('bob')));

      // The thief's copy only fails *after* the real device rotates it — which is exactly
      // the moment worth detecting.
      expect((await post('refresh', stolen)).status).toBe(200);
      const replay = await post('refresh', stolen);

      expect(replay.status).toBe(401);
      expect(await liveSessions(bob)).toBe(0);
    });

    it('rejects a request that carries no session', async () => {
      const res = await post('refresh');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the presented session and expires the cookie', async () => {
      const dave = await sessionId('dave');
      const cookie = rawCookie(await login(emailFor('dave')));

      const res = await post('logout', cookie);
      expect(res.status).toBe(204);
      expect(rawCookie(res, true)).toMatch(/Max-Age=0/i);
      expect(await liveSessions(dave)).toBe(0);

      expect((await post('refresh', cookie)).status).toBe(401);
    });
  });
});
