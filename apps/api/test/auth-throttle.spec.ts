import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The login endpoint is the only one a stranger can hammer without an account, so it is the
 * one place the coarse global limit is not enough. This spec owns its app instance because
 * the budget it exhausts is per-process.
 */
describe('credential throttling', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const RUN = randomUUID().slice(0, 8);

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.user.deleteMany({ where: { email: { contains: `.${RUN}@` } } });
    await prisma.$disconnect();
  });

  it('stops answering the login form once the budget is spent, in the error envelope', async () => {
    let status = 0;
    // Wrong passwords are all this takes: the budget is per address, not per outcome.
    for (let attempt = 0; attempt < 25 && status !== 429; attempt += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `nothing.${RUN}@localtest.me`, password: 'not the password' });
      status = res.status;
    }
    expect(status).toBe(429);

    const limited = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `nothing.${RUN}@localtest.me`, password: 'not the password' });

    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 });
    expect(limited.body.requestId).toBeTruthy();
    // The portal needs this to know when to stop retrying.
    expect(limited.headers['retry-after']).toBeTruthy();
  });
});
