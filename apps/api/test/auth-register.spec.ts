import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Registration is the first endpoint that writes a person, so it is also the first place
 * where "never trust the client" has to be true: the role must not be escalatable, the
 * password must not be readable, and a taken address must not say whether it is taken by
 * an account that can sign in.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const PASSWORD = 'correct horse battery staple';

/** Returns the supertest chainable rather than a promise so `.expect()` still composes. */
function register(app: INestApplication, overrides: Record<string, unknown> = {}): request.Test {
  return request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email: emailFor('teacher'),
      password: PASSWORD,
      fullName: 'Asha Verma',
      role: 'teacher',
      ...overrides,
    });
}

describe('POST /api/v1/auth/register', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email: { contains: `.${RUN}@` } } } });
    await prisma.user.deleteMany({ where: { email: { contains: `.${RUN}@` } } });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('creates a teacher account and returns it without any credential material', async () => {
    const res = await register(app).expect(201);

    expect(res.body.user).toMatchObject({
      email: emailFor('teacher'),
      fullName: 'Asha Verma',
      role: 'teacher',
      status: 'active',
      timezone: 'UTC',
    });
    expect(res.body.user.id).toMatch(/[0-9a-f-]{36}/i);
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it('stores a digest, never the password, and salts it per account', async () => {
    await register(app, { email: emailFor('salt-a') }).expect(201);
    await register(app, { email: emailFor('salt-b') }).expect(201);

    const users = await prisma.user.findMany({
      where: { email: { contains: `.${RUN}@` } },
      select: { passwordHash: true },
    });

    expect(users).toHaveLength(2);
    for (const user of users) {
      expect(user.passwordHash).not.toContain(PASSWORD);
    }
    // Identical passwords must not produce identical rows, or a leaked table sorts users
    // into "same password" groups.
    const distinctHashes = new Set(users.map((user) => user.passwordHash));
    expect(distinctHashes.size).toBe(2);
  });

  it('normalises the address so casing cannot fork an identity', async () => {
    await register(app, { email: `  MiXeD.Case.${RUN}@LocalTest.me  ` }).expect(201);

    const res = await register(app, { email: `mixed.case.${RUN}@localtest.me` }).expect(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_TAKEN');
  });

  it('reports a taken address as a field error the form can show', async () => {
    await register(app, { email: emailFor('taken') }).expect(201);

    const res = await register(app, { email: emailFor('taken') }).expect(409);
    expect(res.body).toMatchObject({
      code: 'EMAIL_ALREADY_TAKEN',
      details: { validation: { email: [expect.any(String)] } },
    });
  });

  it('refuses to self-register an ops account', async () => {
    const res = await register(app, { email: emailFor('ops'), role: 'ops' }).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.role).toEqual([expect.any(String)]);
  });

  it('rejects a short password by name of the field that failed', async () => {
    const res = await register(app, { password: 'too short' }).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.password.join(' ')).toMatch(/password/i);
  });

  it('rejects an unknown property instead of ignoring it', async () => {
    const res = await register(app, { isActive: false }).expect(400);

    expect(JSON.stringify(res.body.details)).toContain('isActive');
  });

  it('keeps a disabled account out of the active default without trusting the client', async () => {
    await register(app, { email: emailFor('created'), role: 'student' }).expect(201);

    const user = await prisma.user.findFirstOrThrow({
      where: { email: emailFor('created') },
      include: { status: true, role: true },
    });
    expect(user.isActive).toBe(true);
    expect(user.status.code).toBe('active');
    expect(user.role.code).toBe('student');
  });
});
