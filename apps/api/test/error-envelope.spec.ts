import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  INestApplication,
  Post,
  Body,
} from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { Public } from '../src/modules/auth/public.decorator';
import { createTestApp } from './utils/create-test-app';

class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

/** Stands in for a real feature route so the pipeline can be tested in isolation. */
@Public()
@Controller('_error-probe')
class ErrorProbeController {
  @Get('boom')
  boom(): never {
    throw new Error('connection refused to postgresql://internal-host');
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'That slot is already taken',
    });
  }

  @Post('register')
  register(@Body() dto: RegisterDto): { email: string } | never {
    if (dto.email.endsWith('.invalid')) {
      throw new BadRequestException({
        code: 'EMAIL_ALREADY_TAKEN',
        message: 'Email already registered',
      });
    }
    return { email: dto.email };
  }
}

describe('error envelope', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // AppModule supplies the global filter and the request-id middleware; the probe
    // controller only adds the routes under test.
    app = await createTestApp({ imports: [AppModule], controllers: [ErrorProbeController] });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns one shape for validation failures, keyed by field', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/_error-probe/register')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.statusCode).toBe(400);
    expect(res.body.requestId).toMatch(/[0-9a-f-]{36}/i);
    // Keyed by field, not a flat list: a form highlights `email`, and a client cannot
    // find the field in "email must be an email" without reparsing English.
    expect(res.body.details.validation).toMatchObject({
      email: [expect.stringMatching(/must be an email/)],
      password: [expect.stringMatching(/password/)],
    });
  });

  it('accepts a valid payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/_error-probe/register')
      .send({ email: 'teacher@example.com', password: 'a'.repeat(14) })
      .expect(201);

    expect(res.body).toEqual({ email: 'teacher@example.com' });
  });

  it('passes through an explicit domain code', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/_error-probe/conflict').expect(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'That slot is already taken' });
  });

  it('keeps an unhandled error as a generic 500 without leaking internals', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/_error-probe/boom').expect(500);

    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('postgres');
    expect(JSON.stringify(res.body)).not.toContain('internal-host');
    expect(res.body).not.toHaveProperty('stack');
  });

  it('strips unknown properties instead of trusting them', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/_error-probe/register')
      .send({ email: 'teacher@example.com', password: 'a'.repeat(14), isActive: false })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body.details)).toContain('isActive');
  });

  it('echoes a caller-supplied request id so a trace can be correlated', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/_error-probe/conflict')
      .set('x-request-id', 'trace-me-please')
      .expect(409);

    expect(res.body.requestId).toBe('trace-me-please');
    expect(res.headers['x-request-id']).toBe('trace-me-please');
  });
});
