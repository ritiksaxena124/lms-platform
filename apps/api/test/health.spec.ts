import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { createTestApp } from './utils/create-test-app';

describe('GET /api/v1/health (contract)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: [AppModule] });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 200 with service status, database status and version', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'up',
      version: expect.any(String),
      uptimeSeconds: expect.any(Number),
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reports the same error envelope for an unknown route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: expect.any(String),
      requestId: expect.any(String),
    });
    expect(res.body.timestamp).toBeTruthy();
  });
});
