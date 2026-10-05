import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// `.env.test` is read last so it wins over the developer `.env`. Assignment is explicit
// because `process.loadEnvFile` skips keys already present in the environment, which
// silently left the suite pointing at the development database.
const ENV_FILES = ['.env', '.env.test'];

/**
 * Loads the test environment and makes sure `lms_test` has every migration applied
 * before any spec runs. Data isolation between specs is per-file (each one cleans up what it
 * filed), so the suite can run repeatedly without truncating anything — with one exception,
 * `clearMailQueue` below, which is about a table no file owns on its own.
 *
 * The migration CLI is only spawned when a migration is genuinely missing — starting it
 * costs several seconds and would otherwise dominate every test run.
 */
export async function setup(): Promise<void> {
  for (const file of ENV_FILES) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const [key, value] of parseEnvFile(readFileSync(path, 'utf8'))) {
      process.env[key] = value;
    }
  }
  process.env.NODE_ENV = 'test';

  if (!process.env.DATABASE_URL?.includes('lms_test')) {
    // Credentials are stripped: this message lands in CI logs and terminal scrollback.
    const shown = process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, '//***@') ?? '(unset)';
    throw new Error(`Tests must run against lms_test, got: ${shown}`);
  }

  if (await hasUnappliedMigrations()) {
    execSync('bunx prisma migrate deploy', { stdio: 'inherit', env: process.env });
  }

  await clearMailQueue();
}

/**
 * The run starts from an empty queue.
 *
 * Every other table in `lms_test` is left alone, because a spec reads what a previous spec happened
 * to leave and the suite survives it. The mail queue is the exception, and the reason is a question
 * a sweep asks of the whole table at once: `claimDue` takes the oldest due rows, and
 * `reclaimAbandoned` counts every claim older than a run. Rows a killed process left behind are
 * older than anything a fixture can honestly be dated at — this file's own backdate is six hours, and
 * a leftover from last week beats it — so the suite's counts become a fact about whenever the box was
 * last interrupted rather than about the queue. CI never sees this because its database is empty; a
 * local one is only ever warm.
 *
 * Nothing outside the suite writes this table, so emptying it costs no example anybody keeps.
 */
async function clearMailQueue(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const { count } = await prisma.mailOutbox.deleteMany();
    if (count > 0) console.log(`Cleared ${count} leftover row(s) from the mail queue`);
  } finally {
    await prisma.$disconnect();
  }
}

export function parseEnvFile(contents: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (key) entries.set(key, value);
  }
  return entries;
}

async function hasUnappliedMigrations(): Promise<boolean> {
  const migrationsDir = resolve('prisma/migrations');
  if (!existsSync(migrationsDir)) return false;

  const local = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const applied = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM _prisma_migrations',
    );
    const names = new Set(applied.map((row) => row.migration_name));
    return local.some((name) => !names.has(name));
  } catch {
    // No migrations table yet: the database is empty and needs the full deploy.
    return true;
  } finally {
    await prisma.$disconnect();
  }
}
