import { describe, expect, it } from 'vitest';

import { buildLogLine, collectParams, sanitize } from './app-logger.service';
import { currentLogContext, runWithLogContext } from './log-context';

describe('structured log line', () => {
  it('always carries time, level, message and module', () => {
    const line = buildLogLine({
      level: 'log',
      message: 'booking created',
      module: 'Bookings',
      bookingId: 'b1',
    });
    expect(line.level).toBe('log');
    expect(line.msg).toBe('booking created');
    expect(line.module).toBe('Bookings');
    expect(line.bookingId).toBe('b1');
    expect(new Date(line.time).getTime()).not.toBeNaN();
  });

  it('drops undefined context fields so production JSON stays small', () => {
    const line = buildLogLine({ level: 'log', message: 'm', requestId: undefined });
    expect(JSON.parse(JSON.stringify(line))).not.toHaveProperty('requestId');
  });
});

describe('log redaction', () => {
  it('redacts secrets nested at any depth, including inside arrays', () => {
    const sanitized = sanitize({
      email: 'teacher@example.com',
      password: 'hunter2',
      user: { displayName: 'A', refreshToken: 'abc' },
      headers: [{ authorization: 'Bearer x', accept: 'application/json' }],
    }) as Record<string, unknown>;

    expect(sanitized.email).toBe('teacher@example.com');
    expect(sanitized.password).toBe('[redacted]');
    expect((sanitized.user as Record<string, unknown>).refreshToken).toBe('[redacted]');
    expect((sanitized.user as Record<string, unknown>).displayName).toBe('A');
    const header = (sanitized.headers as Array<Record<string, unknown>>)[0]!;
    expect(header.authorization).toBe('[redacted]');
    expect(header.accept).toBe('application/json');
  });

  it('redacts a connection string that doubles as a secret', () => {
    const sanitized = sanitize({ databaseUrl: 'postgresql://lms:pw@localhost:5432/lms' });
    expect(sanitized.databaseUrl).toBe('[redacted]');
  });

  it('never leaks a password embedded in an error message', () => {
    const error = new Error('auth failed password=hunter2 for user');
    const sanitized = sanitize({ error });
    expect(JSON.stringify(sanitized)).not.toContain('hunter2');
  });

  it('survives self-referencing and deeply nested payloads', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(() => sanitize(cyclic)).not.toThrow();
  });
});

describe('collectParams', () => {
  it('reads Nest context strings instead of exploding them into characters', () => {
    const collected = collectParams(['HealthController'], 'App');
    expect(collected.module).toBe('HealthController');
    expect(collected.fields).toEqual({});
  });

  it('merges object fields and keeps the last string as the module', () => {
    const collected = collectParams([{ durationMs: 12 }, 'Http'], 'App');
    expect(collected).toEqual({ module: 'Http', fields: { durationMs: 12 } });
  });

  it('falls back to the logger context when nothing is passed', () => {
    expect(collectParams([], 'Bootstrap').module).toBe('Bootstrap');
  });
});

describe('log context', () => {
  it('binds the request identity for the duration of the run only', () => {
    expect(currentLogContext()).toEqual({});
    runWithLogContext({ requestId: 'r1', userId: 'u1' }, () => {
      expect(currentLogContext()).toEqual({ requestId: 'r1', userId: 'u1' });
    });
    expect(currentLogContext()).toEqual({});
  });
});
