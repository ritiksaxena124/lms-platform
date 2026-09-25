# LMS Platform POC — Teacher Marketplace

A marketplace where learners book 1:1 and group sessions with independent teachers.
Three portals (teacher, student, ops) share one API, one database and one component
library.

**Status: Phase 1 complete** — foundation only. No auth, courses or bookings exist yet;
those are Phases 2+. See [Phase plan](#phases).

---

## Prerequisites

| Tool     | Version | Notes                                            |
| -------- | ------- | ------------------------------------------------ |
| Bun      | ≥ 1.2   | package manager, runner and test driver          |
| Node     | ≥ 22    | Next.js and Prisma CLI run on Node               |
| Postgres | ≥ 16    | local server; extensions `pg_trgm`, `btree_gist` |

## First run

```bash
bun install

# 1. API environment — the .env files are generated locally and never committed.
cp apps/api/.env.example apps/api/.env       # set DATABASE_URL for the lms database
cp apps/api/.env.example apps/api/.env.test  # DATABASE_URL must point at lms_test

# 2. Database (roles and databases are created once, by hand, on the local server)
bun run --filter @lms/api db:generate
bun run --filter @lms/api db:migrate

# 3. Everything else is derived from those two files
bun run verify        # build + typecheck + lint + test across the workspace
bun run dev           # API on :4000, teacher portal on :3000
```

Then open <http://teacher.localtest.me:3000>. `*.localtest.me` resolves to `127.0.0.1`
and gives every portal a subdomain of one registrable domain, which is what lets the
three apps share a session cookie in development without `localhost` CORS hacks.

## Commands

| Command               | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `bun run verify`      | The gate: shared build, typecheck, lint, tests. Run before every commit. |
| `bun run dev`         | API + teacher portal together.                                           |
| `bun run dev:api`     | NestJS API with watch mode.                                              |
| `bun run dev:teacher` | Next.js teacher portal.                                                  |
| `bun run test`        | All test suites (Vitest, per workspace package).                         |
| `bun run format`      | Prettier over TS/TSX/JSON/MD/Prisma.                                     |

## Layout

```
apps/
  api/        NestJS modular monolith — the only writer to the database
  teacher/    Next.js App Router portal for teachers (built first)
packages/
  shared/     Framework-free TypeScript: error codes, lookup codes, money, timezones
  ui/         Design tokens, primitives and motion shared by all three portals
```

`@lms/shared` is consumed as compiled CommonJS by the API and as source by the apps
(`transpilePackages`). `@lms/ui` is always consumed as source — it ships no build step,
which is why editing a component hot-reloads in the portal.

## Conventions that are enforced, not documented-away

- **No hard deletes.** `prisma.$delete*`, `truncate` and `dropTable` are ESLint errors.
  Rows are deactivated with `isActive`; see `ARCHITECTURE.md`.
- **No enums for business constants.** Reference data lives in `LkpType`/`LkpValue`
  tables, with the code strings typed in `@lms/shared`.
- **One error envelope.** Every failure is `{ statusCode, code, message, requestId }`.
- **Tests before implementation.** A phase starts by making a failing test exist.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before adding a module — it records _why_ each
decision was made, and what was deliberately left out.

## Phases

| Phase | Scope                                                        | Status      |
| ----- | ------------------------------------------------------------ | ----------- |
| 0     | Plan, architecture, data model                               | Approved    |
| 1     | Monorepo, API foundation, DB + Prisma, shared, UI kit, shell | **Done**    |
| 2     | Auth, accounts, roles, teacher profile                       | Not started |
| 3     | Courses, lessons, enrollment                                 | Not started |
| 4     | Availability, bookings, scheduling across timezones          | Not started |
| 5     | Video + storage + email behind provider ports                | On hold     |
| 6     | Payments (free-tier provider only)                           | On hold     |
| 7     | Student and ops portals                                      | Not started |

## Environment variables

`apps/api/.env.example` documents every variable. Two are worth knowing early:

- `PAYMENT_PROVIDER` and `VIDEO_PROVIDER` default to `none`. Those integrations are on
  hold until a free option is chosen; the ports exist so nothing else has to change when
  they land.
- `STORAGE_PROVIDER=local` writes uploads to `storage/` (gitignored). `s3` is rejected at
  boot until it is actually implemented.
