import { describe, expect, it } from 'vitest';

import { isRedactedKey, parseEnv } from './env';

const BASE = {
  NODE_ENV: 'test',
  CORS_ORIGINS: 'http://teacher.localtest.me:3002',
  API_PUBLIC_URL: 'http://api.localtest.me:4000',
  TEACHER_PORTAL_URL: 'http://teacher.localtest.me:3000',
  STUDENT_PORTAL_URL: 'http://student.localtest.me:3001',
  DATABASE_URL: 'postgresql://lms:lms@localhost:5432/lms_test',
  JWT_SECRET: 'a'.repeat(64),
};

describe('parseEnv', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = parseEnv({ ...BASE });
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://teacher.localtest.me:3002']);
    expect(env.MAX_UPLOAD_MB).toBe(15);
    expect(env.PAYMENT_PROVIDER).toBe('none');
    expect(env.VIDEO_PROVIDER).toBe('none');
    expect(env.JITSI_DOMAIN).toBe('meet.jit.si');
  });

  it('stays on loopback unless it is told to answer the network', () => {
    // The laptop default. In a container this has to be overridden, because a process bound to
    // 127.0.0.1 accepts nothing from another container — but the code keeps the conservative value so
    // a host run never opens the port to the network by accident.
    expect(parseEnv({ ...BASE }).LISTEN_HOST).toBe('127.0.0.1');
    expect(parseEnv({ ...BASE, LISTEN_HOST: '0.0.0.0' }).LISTEN_HOST).toBe('0.0.0.0');
  });

  it('takes jitsi as the video provider, and the bridge it should point classes at', () => {
    const env = parseEnv({
      ...BASE,
      VIDEO_PROVIDER: 'jitsi',
      JITSI_DOMAIN: 'calls.example-school.org',
    });
    expect(env.VIDEO_PROVIDER).toBe('jitsi');
    expect(env.JITSI_DOMAIN).toBe('calls.example-school.org');
  });

  it('has no video provider beyond the adapters that exist', () => {
    // `mock` was a placeholder written before Phase 5 chose Jitsi. Accepting a value nothing
    // implements is how a deployment boots with video it only thinks it has.
    expect(() => parseEnv({ ...BASE, VIDEO_PROVIDER: 'mock' })).toThrow(/VIDEO_PROVIDER/);
  });

  it('rejects an empty CORS list instead of silently allowing every origin', () => {
    expect(() => parseEnv({ ...BASE, CORS_ORIGINS: '  ,  ' })).toThrow(/CORS_ORIGINS/);
  });

  it('takes the two portal origins a notification links back to', () => {
    const env = parseEnv(BASE);
    expect(env.TEACHER_PORTAL_URL).toBe('http://teacher.localtest.me:3000');
    expect(env.STUDENT_PORTAL_URL).toBe('http://student.localtest.me:3001');
  });

  it('refuses to boot when it would have to guess where a button leads', () => {
    // `API_PUBLIC_URL` is the API's own address, and a mail that linked to it would open a JSON
    // error in front of a person expecting their class list. A default of `localhost` would boot
    // happily and then send links nobody on the internet can open.
    expect(() => parseEnv({ ...BASE, TEACHER_PORTAL_URL: '' })).toThrow(/TEACHER_PORTAL_URL/);
    expect(() => parseEnv({ ...BASE, STUDENT_PORTAL_URL: '' })).toThrow(/STUDENT_PORTAL_URL/);
    expect(() => parseEnv({ ...BASE, TEACHER_PORTAL_URL: 'teacher.localtest.me' })).toThrow(
      /TEACHER_PORTAL_URL/,
    );
  });

  it('rejects a non-postgres database url with a readable message', () => {
    expect(() => parseEnv({ ...BASE, DATABASE_URL: 'mysql://x' })).toThrow(
      /DATABASE_URL must be a postgresql/,
    );
  });

  it('refuses to boot in production with a weak JWT secret', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
    expect(() =>
      parseEnv({ ...BASE, NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32) }),
    ).not.toThrow();
  });

  it('names every offending variable rather than the first one only', () => {
    const error = (() => {
      try {
        parseEnv({ NODE_ENV: 'test' } as Record<string, string>);
        return null;
      } catch (caught) {
        return (caught as Error).message;
      }
    })();

    expect(error).toMatch(/CORS_ORIGINS/);
    expect(error).toMatch(/API_PUBLIC_URL/);
    expect(error).toMatch(/DATABASE_URL/);
    expect(error).toMatch(/TEACHER_PORTAL_URL/);
    expect(error).toMatch(/STUDENT_PORTAL_URL/);
  });

  it('treats a blank value in an env file as unset', () => {
    const env = parseEnv({ ...BASE, SMTP_URL: '  ', COOKIE_DOMAIN: '' });
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.COOKIE_DOMAIN).toBeUndefined();
  });

  it('refuses to start without a signing secret, in any environment', () => {
    // A random per-process fallback would boot cleanly and then log everyone out on the
    // next restart, so the missing value has to stop the boot instead.
    expect(() => parseEnv({ ...BASE, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({ ...BASE, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('sends the session cookie over https unless the environment says otherwise', () => {
    expect(parseEnv(BASE).cookieSecure).toBe(false); // NODE_ENV=test is plain http
    expect(parseEnv({ ...BASE, NODE_ENV: 'production' }).cookieSecure).toBe(true);
    // A proxy that terminates TLS makes production plain-http at the app, so it overrides.
    expect(parseEnv({ ...BASE, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookieSecure).toBe(
      false,
    );
  });

  it('fails fast when a provider is configured before its adapter exists', () => {
    expect(() => parseEnv({ ...BASE, STORAGE_PROVIDER: 's3' })).toThrow(
      /S3 storage is not implemented/,
    );
  });
});

describe('log redaction', () => {
  it('matches secret-looking keys in any casing or separator style', () => {
    for (const key of [
      'password',
      'new_password',
      'accessToken',
      'Authorization',
      'api-key',
      'DATABASE_URL',
      'jwtSecret',
    ]) {
      expect(isRedactedKey(key)).toBe(true);
    }
    for (const key of ['email', 'courseId', 'status', 'isActive']) {
      expect(isRedactedKey(key)).toBe(false);
    }
  });
});
