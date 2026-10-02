import { z } from 'zod';

/**
 * Environment is validated once, at boot. A missing or malformed value aborts startup
 * with the offending keys listed instead of surfacing later as a runtime failure —
 * and no secret has a code-level default.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  /** The interface to bind. Loopback by default so a host run never opens the port to the network by
   * accident; a container sets `0.0.0.0`, because nothing on another container's interface can reach
   * an address that only exists inside this one. */
  LISTEN_HOST: z.string().min(1).default('127.0.0.1'),

  CORS_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .refine((origins) => origins.length > 0, {
      message: 'at least one allowed origin is required',
    }),
  API_PUBLIC_URL: z.url(),

  /** Where a reader is sent. A notification's button is one of these origins plus a page inside it,
   * and neither can be derived from `API_PUBLIC_URL`: the portals are served on their own hosts, and
   * a link that opened the API would show a person a JSON error where their class list should be.
   * Both are required rather than defaulted to `localhost`, because a box that boots with a guessed
   * origin sends every message a link nobody can open (§6). */
  TEACHER_PORTAL_URL: z.url(),
  STUDENT_PORTAL_URL: z.url(),

  DATABASE_URL: z.string().refine((value) => value.startsWith('postgresql://'), {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  }),

  JWT_SECRET: z.string().min(32),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  /** Host the session cookie is shared across, e.g. `localtest.me` so one login covers
   * every portal. Unset keeps the cookie to the API host alone. */
  COOKIE_DOMAIN: z.string().min(1).optional(),
  /** Overrides the NODE_ENV-based default; useful when a staging box terminates TLS upstream. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('./storage/uploads'),
  // There is deliberately no public URL for stored bytes: the read route carries the gate
  // (§6), so a config key promising a link to them would be a door around it.
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(200).default(15),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // Payments are on hold: no vendor SDK may be wired until a free provider is approved, so
  // `none` is a first-class value rather than a TODO comment.
  PAYMENT_PROVIDER: z.enum(['none', 'mock']).default('none'),
  // Video chose Jitsi in Phase 5 (§10). `none` stays a value a deployment can run on — an
  // unconfigured box has live classes switched off, not broken.
  VIDEO_PROVIDER: z.enum(['none', 'jitsi']).default('none'),
  /** The bridge a class is held on: a bare host, no scheme and no path. The public meet.jit.si
   * is the default because it needs no account; a self-hosted bridge is the same adapter with
   * this pointed at it. Judged when the provider is built, so a value that is not a host stops
   * the boot rather than sending a class somewhere unexpected. */
  JITSI_DOMAIN: z.string().min(1).default('meet.jit.si'),
});

export type AppEnv = z.infer<typeof EnvSchema> & {
  /** Resolved below: secure unless a local run over plain http says otherwise. */
  cookieSecure: boolean;
};

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  // A variable present but blank in an env file means "not provided"; without this,
  // `JWT_SECRET=` would fail the length check instead of reading as unset.
  const provided = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && String(value).trim() !== ''),
  );

  const parsed = EnvSchema.safeParse(provided);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  if (env.STORAGE_PROVIDER === 's3') {
    throw new Error('S3 storage is not implemented yet; set STORAGE_PROVIDER=local');
  }

  return {
    ...env,
    cookieSecure:
      env.COOKIE_SECURE === undefined
        ? env.NODE_ENV === 'production'
        : env.COOKIE_SECURE === 'true',
  };
}

export const REDACTED_KEYS = [
  'password',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'paymentsecret',
  'databaseurl',
] as const;

export function isRedactedKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return REDACTED_KEYS.some((candidate) => normalized.includes(candidate));
}
