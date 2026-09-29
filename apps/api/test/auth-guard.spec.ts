import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { Roles } from '../src/modules/auth/roles.decorator';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Who a request is allowed to act as is decided by the server, every request. The access
 * token proves where the claim came from; the database says what is true now — because an
 * account can be disabled, and a teacher can be moved to ops, while a token is still valid.
 */
@Controller('_guard-probe')
class GuardProbeController {
  @Get('any-signed-in-user')
  anyUser(): { ok: true } {
    return { ok: true } as const;
  }

  @Get('ops-only')
  @Roles('ops')
  opsOnly(): { ok: true } {
    return { ok: true } as const;
  }
}

const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();

async function bearer(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

function get(path: string, token?: string): request.Test {
  const call = request(app.getHttpServer()).get(`/api/v1/${path}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

/** A token signed by us, so the failure paths can be produced without waiting them out. */
function forgedToken(claims: Record<string, unknown>, secret = process.env.JWT_SECRET): string {
  return sign(claims, secret ?? 'missing', {
    algorithm: 'HS256',
    issuer: 'lms-api',
    audience: 'lms-portals',
  });
}

describe('the bearer token guard', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule], controllers: [GuardProbeController] });
    for (const name of ['alice', 'mallory']) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: emailFor(name),
          password: PASSWORD,
          fullName: 'Guard Test',
          role: name === 'alice' ? 'teacher' : 'student',
        });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    }
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
    // A sign-in is a write, and the row it filed names this account: the ledger outlives the account
    // it describes, so the fixture has to take its own records down first (§7).
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('answers an unauthenticated request with the envelope, not a stack trace', async () => {
    const res = await get('auth/me').expect(401);

    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body).not.toHaveProperty('stack');
  });

  it('rejects a token it did not sign', async () => {
    const res = await get(
      'auth/me',
      forgedToken({ sub: 'someone', role: 'ops' }, 'a- completely different secret'),
    ).expect(401);

    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('rejects an expired token as expired rather than invalid', async () => {
    const alice = await prisma.user.findFirstOrThrow({ where: { email: emailFor('alice') } });
    // Signed correctly and eleven seconds stale: the person needs to know to refresh.
    const now = Math.floor(Date.now() / 1000);
    const expired = forgedToken({
      sub: alice.id,
      role: 'teacher',
      typ: 'access',
      iat: now - 11,
      exp: now - 1,
    });

    const res = await get('auth/me', expired).expect(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('refuses a refresh cookie presented as a bearer token', async () => {
    const res = await get('auth/me', 'not-a-jwt-at-all').expect(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('returns the signed-in account from /auth/me', async () => {
    const res = await get('auth/me', await bearer('alice')).expect(200);

    expect(res.body.user).toMatchObject({ email: emailFor('alice'), role: 'teacher' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('lets a signed-in student past a route with no role requirement', async () => {
    await get('_guard-probe/any-signed-in-user', await bearer('mallory')).expect(200);
  });

  it('refuses a route whose role the token does not carry', async () => {
    const res = await get('_guard-probe/ops-only', await bearer('alice')).expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
    // The message must not enumerate what the caller is missing.
    expect(JSON.stringify(res.body)).not.toContain('permissions');
  });

  it('re-reads the role, so a promotion takes effect without a new token', async () => {
    const alice = await prisma.user.findFirstOrThrow({ where: { email: emailFor('alice') } });
    const token = await bearer('alice');
    await get('_guard-probe/ops-only', token).expect(403);

    // Ops promotes her mid-token. A role trusted from the claim would keep denying her
    // for the rest of the token's life; the point is that the claim is not the truth.
    await prisma.user.update({
      where: { id: alice.id },
      data: { roleValueId: await lookupId('UserRole', 'ops') },
    });
    await get('_guard-probe/ops-only', token).expect(200);
  });

  it('stops honouring a token the moment the account is disabled', async () => {
    const mallory = await prisma.user.findFirstOrThrow({ where: { email: emailFor('mallory') } });
    const token = await bearer('mallory');
    await get('auth/me', token).expect(200);

    await prisma.user.update({
      where: { id: mallory.id },
      data: { statusValueId: await lookupId('AccountStatus', 'disabled') },
    });

    const res = await get('auth/me', token).expect(403);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('leaves the public routes public', async () => {
    await get('health').expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: emailFor('nobody'), password: 'not the password' })
      .expect(401);
  });
});

async function lookupId(typeCode: string, code: string): Promise<string> {
  const value = await prisma.lkpValue.findFirstOrThrow({
    where: { code, type: { code: typeCode } },
  });
  return value.id;
}
