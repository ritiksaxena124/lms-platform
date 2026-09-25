import { z } from 'zod';

/**
 * Environment is validated once, at boot. A missing or malformed value aborts startup
 * with the offending keys listed instead of surfacing later as a runtime failure —
 * and no secret has a code-level default.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

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

  DATABASE_URL: z.string().refine((value) => value.startsWith('postgresql://'), {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  }),

  JWT_SECRET: z.string().min(32).optional(),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('./storage/uploads'),
  STORAGE_PUBLIC_URL: z.string().min(1).default('http://api.localtest.me:4000/files'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(200).default(15),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // Payments and video are on hold: no vendor SDK may be wired until a free provider is
  // approved, so `none` is a first-class value rather than a TODO comment.
  PAYMENT_PROVIDER: z.enum(['none', 'mock']).default('none'),
  VIDEO_PROVIDER: z.enum(['none', 'mock']).default('none'),
});

export type AppEnv = z.infer<typeof EnvSchema>;

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
  if (env.NODE_ENV === 'production') {
    const required: Array<keyof AppEnv> = ['JWT_SECRET'];
    const missing = required.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables in production: ${missing.join(', ')}`,
      );
    }
  }
  if (env.STORAGE_PROVIDER === 's3') {
    throw new Error('S3 storage is not implemented yet; set STORAGE_PROVIDER=local');
  }

  return env;
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
