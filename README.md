# LMS Platform POC — Teacher Marketplace

A marketplace where learners book 1:1 and group sessions with independent teachers.
Three portals (teacher, student, ops) share one API, one database and one component
library.

**Status: Phase 2 in progress** — accounts sign in, hold a session and a teacher can save a
profile. No courses, bookings or payments exist yet; those are Phases 3+.
See [Phase plan](#phases).

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
# JWT_SECRET has no default in either file; generate one:  openssl rand -hex 32

# 2. Database (roles and databases are created once, by hand, on the local server)
bun run --filter @lms/api db:generate
bun run --filter @lms/api db:migrate
bun run --filter @lms/api db:seed       # reference rows + the three demo accounts below

# 3. Everything else is derived from those two files
bun run verify        # build + typecheck + lint + test across the workspace
bun run dev           # API on :4000, teacher portal on :3000
```

Then open <http://teacher.localtest.me:3000>. `*.localtest.me` resolves to `127.0.0.1`
and gives every portal a subdomain of one registrable domain, which is what lets the
three apps share a session cookie in development without `localhost` CORS hacks.

### Signing in

`db:seed` also creates three accounts. Their password is not a secret — being easy to type
is the entire reason they exist:

| Account                | Portal                                                   |
| ---------------------- | -------------------------------------------------------- |
| `teacher@example.test` | teacher portal                                           |
| `student@example.test` | student portal                                           |
| `ops@example.test`     | ops portal — the role the sign-up form will not hand out |

All three sign in with `lms-demo-password`. They are created only in `lms` and `lms_test`:
seeding refuses when `NODE_ENV=production`, and re-running `db:seed` after you have changed
one leaves it changed. The addresses sit under the reserved `.test` domain, so a demo
account can never be pointed at a real mailbox.

## Commands

| Command               | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `bun run verify`      | The gate: shared build, typecheck, lint, tests. Run before every commit. |
| `bun run dev`         | API + teacher portal together.                                           |
| `bun run dev:api`     | NestJS API with watch mode.                                              |
| `bun run dev:teacher` | Next.js teacher portal.                                                  |
| `bun run dev:ui`      | Storybook for `@lms/ui` on <http://localhost:6006>.                      |
| `bun run test`        | All test suites (Vitest, per workspace package).                         |
| `bun run format`      | Prettier over TS/TSX/JSON/MD. `schema.prisma` uses `prisma format`.      |

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

## Design system — Graphite

Storybook is the surface the design system is maintained in: `bun run dev:ui` after
changing anything under `packages/ui/src`. The **Design System** story states the rules,
not just the values, so an unlisted component can still be made to look like it belongs.

Four rules outrank taste:

- **One typeface.** Inter Variable, 100–900, self-hosted from `@fontsource-variable/inter`
  and imported by `@lms/ui/styles.css`. Portals add no font request of their own.
- **Borders separate, surfaces stack.** Flat layout gets a 1px line. The only shadow in the
  system (`--shadow-overlay`) belongs to things that float: menus, dialogs, toasts.
- **Colour is meaningful.** Graphite neutrals do the structural work; brand emerald marks
  the primary action; semantic tones stay in their own hue families.
- **Gradient is a highlighter.** Exactly three exist (`--gradient-brand`, `-brand-wash`,
  `-paper-sheen`), each with a named job. A fourth needs a reason, not a taste.

Illustrations are hand-drawn characters from [Open Peeps](https://www.openpeeps.com),
CC0, vendored under `packages/ui/illustrations/`. `bun run --filter @lms/ui
sync:illustrations` copies them into each portal's `public/`; render them with `<Illo>`,
which reserves the slot so a reveal never reflows.

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
| 2     | Auth, accounts, roles, teacher profile                       | In progress |
| 3     | Courses, lessons, enrollment                                 | Not started |
| 4     | Availability, bookings, scheduling across timezones          | Not started |
| 5     | Video + storage + email behind provider ports                | On hold     |
| 6     | Payments (free-tier provider only)                           | On hold     |
| 7     | Student and ops portals                                      | Not started |

## Environment variables

`apps/api/.env.example` documents every variable. Four are worth knowing early:

- `JWT_SECRET` has **no default and no fallback** — sign-in is impossible without it, and a
  per-process random one would boot cleanly then log everyone out on the next restart.
  Generate with `openssl rand -hex 32`.
- `COOKIE_DOMAIN=localtest.me` is what lets one login cover all three portals. Left unset
  the session cookie belongs to the API host alone.
- `PAYMENT_PROVIDER` and `VIDEO_PROVIDER` default to `none`. Those integrations are on
  hold until a free option is chosen; the ports exist so nothing else has to change when
  they land.
- `STORAGE_PROVIDER=local` writes uploads to `storage/` (gitignored). `s3` is rejected at
  boot until it is actually implemented.
