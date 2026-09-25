# Architecture

Records the decisions that bind every contributor, and the reason each one was made.
When something here conflicts with a shortcut that looks faster, this file wins — and if
this file is wrong, change it in the same pull request that changes the code.

---

## 1. Shape of the system

```
teacher portal  ─┐
student portal   ├──> REST /api/v1 ──> NestJS modular monolith ──> PostgreSQL
ops portal      ─┘                        (the only writer)
```

**One API, three Next.js apps.** The portals have different users, different information
density and different release cadences; separate apps keep each one's bundle honest and
let them deploy independently. They share `@lms/ui` (tokens, primitives, motion) and
`@lms/shared` (codes, money, timezones), so "same product, three doors" is a build
constraint rather than a convention.

**Modular monolith, not microservices.** `apps/api/src/modules/<domain>` will hold
courses, bookings, profiles — each with its own controller/service/repository and no
imports from another module's internals. The seams are drawn in code, where they cost
nothing, and stay unused until a measured need appears.

**Deliberately absent:** Redis, Kafka, Elasticsearch, a separate search service, a
gateway, container orchestration, and PostGIS. A POC on a single Linux VPS does not need
them, and each one is a system to operate. Postgres full-text search plus `pg_trgm` covers
the discovery requirements; a `pg_trgm` index is cheaper than an outage in a service nobody
was ready to run.

## 2. Data: nothing is ever destroyed

- Major tables carry `id uuid`, `created_at`, `updated_at`, `is_active`.
- **No hard deletes.** `prisma.$delete*`, `truncate` and `dropTable` are ESLint errors
  (`no-restricted-syntax` in `eslint.config.mjs`). Rows are deactivated: `isActive = false`
  plus `deletedAt` for the audit trail.
- Foreign keys are `onDelete: Restrict`. A cascade would be a silent mass delete, and the
  only way to discover it is after the data is gone.
- **Identity keys are globally unique; business keys are unique among active rows.**
  `users.email` is unique forever — reusing a deleted account's address would resurrect
  history. A `(teacher_id, title)` style key gets a partial unique index
  `WHERE is_active`, so an archived row cannot block a new one.
- Append-only ledgers (payments, moderation decisions, status transitions) never update in
  place; a correction is a new row pointing at the old one.
- A join row follows the same rule: removing a subject from a teacher's profile deactivates
  the row, and adding it back revives that same row. That is what makes
  `@@unique([profile_id, subject_value_id])` safe — an unconditional delete-then-insert
  would fight the no-hard-delete rule, and a partial unique index would let one profile list
  the same subject twice.

## 3. Reference data lives in the database

Business constants are `LkpType` / `LkpValue` rows (`lkp_type`, `lkp_value`), not TypeScript
or Postgres enums. A new booking status is an insert and a translation, not a deploy and a
migration that rewrites a column type. The code strings are still typed —
`packages/shared/src/lookup-codes.ts` exports them as `as const` objects, and
`validateLookupSeeds()` fails the boot if a seed set is missing a code the application
expects. Enums are the one thing you cannot add to without a schema change; codes you can.

An API that speaks these codes translates them at the edge and never deeper: a request body
carries `subjects: ["mathematics"]`, the row carries a `lkp_value` uuid, and
`ReferenceService` is the only file through which the two meet. A response sends
`{ code, label }` rather than a bare code, because a portal that keeps its own translation
table is a second catalogue that starts drifting the day Ops renames one. The order a list of
them reads in is `lkp_value.position`, which is a decision Ops can change; it is never the
order the client happened to send.

## 4. Errors

Every failure leaves the API as one envelope:

```json
{
  "statusCode": 422,
  "code": "VALIDATION_FAILED",
  "message": "Check the highlighted fields.",
  "requestId": "…",
  "timestamp": "…",
  "details": { "validation": { "email": ["Already taken"] } }
}
```

`code` is machine-readable and stable, from `API_ERROR_CODES` in `@lms/shared`; the client
branches on it and never on wording. `message` is written for a human and is safe to show.
Field errors are keyed **by field name**, never as a flat list of sentences — a form has to
know which input to highlight, and parsing English to find out is not that.
For any of that to run, the controller must import its DTO as a **value**. `import type`
erases the class from the emitted parameter metadata, Nest reads the parameter as `Object`,
and the route then answers 200 to a body it should have rejected. The same mistake in a
constructor fails loudly ("Nest can't resolve dependencies"), which makes the parameter
position the dangerous half: it looks like a working endpoint.
Unexpected errors return a generic message while the real cause is logged with the same
`requestId`, so a stack trace, a connection string or an internal hostname can never reach
a browser. `@lms/ui`'s `notify.fromApiError()` renders this exact shape, including field
errors, which is why both sides import the type from one place.

## 5. Time and money

- **Stored in UTC**, `timestamptz`, always. Displayed in the viewer's timezone, or the
  teacher's declared working timezone for availability. Never store a local wall clock as
  if it were an instant.
- Availability is stored as **wall-clock ranges in an IANA zone** (`"Asia/Kolkata",
09:00–17:00`). A DST change then moves the UTC instants, which is what a teacher means
  by "same class time, different season". Converting a fixed UTC offset instead would
  silently shift every class by an hour twice a year.
- Slot creation takes an advisory transaction lock and relies on a unique slot-hold row.
  Two teachers booking the same slot must not both succeed because two requests raced.
- `packages/shared/src/timezone.ts` and `money.ts` are the only places this math lives, and
  both are tested across DST boundaries. Money is an integer in minor units plus a currency
  code — never a float, never a rupee value with an implicit scale.
- **An amount and its currency are one decision, so they are validated as one.** Either half
  on its own is meaningless: a rate without a currency is a number someone will later read
  as rupees, and a currency without a rate is a form field that went nowhere. Both are
  optional together and required as a pair, which is why the DTO uses `@ValidateIf` on the
  pair rather than `@IsOptional` on each — `@IsOptional` skips an absent property, and an
  absent currency is precisely the case that has to fail.
- **A teacher's working zone belongs to the account, not to the profile row.** It decides
  when a class is, what "today" means in a dashboard and when a reminder is humane; a copy on
  the profile would be a second truth to keep in step, so the profile form writes
  `users.timezone` and reads it back from there.

## 6. Third-party providers

Video, storage, payments and email sit behind ports in `apps/api/src/providers`, selected
by environment (`STORAGE_PROVIDER`, `PAYMENT_PROVIDER`, `VIDEO_PROVIDER`, `SMTP_URL`).
Domain code depends on the port, never on a vendor SDK.

`PAYMENT_PROVIDER` and `VIDEO_PROVIDER` currently default to `none`: those integrations are
**on hold** until a genuinely free option is chosen. The ports exist so that choosing one
later is an adapter plus an env change, not a refactor — and so nothing pretends to take a
payment or start a call in the meantime. `STORAGE_PROVIDER=s3` throws at boot rather than
silently doing nothing.

## 7. Sessions and passwords

A session is two tokens with two different jobs, and the split is what makes the rest of
these rules hold:

- **Access token: a 15-minute HS256 JWT**, carrying `sub` and `role` and nothing else. A JWT
  is read by whoever holds it, so an email or a name in the payload would be a copy of
  personal data outliving the login that made it. Its expiry is what bounds the damage of a
  leaked one; the role inside it is treated as a hint, not as authority — see below.
- **Refresh token: an opaque random string in an `HttpOnly` cookie**, stored only as a
  SHA-256 hash, scoped to `Path=/api/v1/auth`. It is rotated on every use, and the row is
  retired rather than deleted — a row that survives is the only way to notice a replay.
- **A retired token presented twice ends every session that account has.** The first use
  proves the token was copied somewhere; there is no way to know where else it went.
- **Unknown address and wrong password answer identically**, including the work: an unknown
  email still verifies against a throwaway digest, so the endpoint cannot be read as a
  directory of who has an account.
- **scrypt from `node:crypto`, behind a `PASSWORD_HASHER` port.** Argon2id is the stronger
  recommendation on paper, but every Argon2 and bcrypt binding is a native module, and
  "builds on the laptop, fails on the VPS" is the worse failure. The cost parameters are
  written _into_ the digest, so raising them later still verifies a password hashed today.
- **A disabled account is refused with `ACCOUNT_DISABLED`, not a fake password error.** That
  person is looking at their own account; there is nothing to hide and something to act on.
- **`ops` is not self-registerable.** The list lives in `@lms/shared`, so the sign-up form
  and the server read the same one and a client payload cannot mint an administrator.
- **Both guards are global, registered in `AuthModule` as `APP_GUARD`.** A feature module
  added next month is authenticated before anyone remembers to ask; the way a route becomes
  public is `@Public()`, and forgetting it fails as a 401 in development rather than as an
  open endpoint in production.
- **The token says who signed in; the row says who they are now.** The guard verifies the
  signature and then re-reads the account for its role and status, so a promotion, a
  demotion and a disable all take effect on the next request instead of on the next login.
  That is one indexed lookup per authenticated request, bought deliberately: without it a
  disabled account keeps whatever it was for up to fifteen minutes.

## 8. Frontend

- **Tokens before components.** `@lms/ui/src/styles/tokens.css` is the only place a colour,
  radius, shadow, duration or type step is defined. A portal re-themes by overriding tokens;
  it does not get to invent `#3b82f6`.
- Every operation has five states in the primitives, not in each page: idle, loading
  (`Button loading` keeps its label and blocks re-clicks), empty (`EmptyState`), error
  (`ErrorState` with a retry that can itself be busy), settled.
- **Toasts go through `notify()`**, which wraps `react-hot-toast` for timing and renders our
  own card. No page calls a toast library directly, so a notification looks the same in all
  three portals and the library can be swapped in one file.
- **Motion is CSS.** Route changes use the View Transitions API via React's
  `<ViewTransition>` (`RouteTransition`), links declare `nav-forward` / `nav-back`, and the
  portal chrome is anchored so only content moves. `prefers-reduced-motion` downgrades
  slides to crossfades in one block — with the single exception of the spinner, because a
  frozen spinner reads as a hung app.
- `@lms/ui` ships TypeScript source with no build step; apps compile it via
  `transpilePackages`. This keeps HMR honest and removes a publish-before-it-works class of
  bug.
- **Storybook is the design system's source of truth for people.** The package has no build
  output to read, so `bun run dev:ui` is how a developer sees a primitive before using it.
  A component without a story is undocumented by definition.
- **One typeface, deliberately.** Inter Variable covers headings, UI and metrics. A second
  family would be a taste decision, and taste does not survive three portals and two
  maintainers. Hierarchy comes from size, weight and colour instead.
- **Borders carry structure; shadow is reserved for float.** Flat layout uses a 1px line, and
  only menus, dialogs and toasts get `--shadow-overlay`. A shadow on static layout is a
  rendering bug waiting for a dark theme.
- **Gradients are named for their job.** Three exist — the primary button face, the welcome
  panel, and a paper sheen. They live as `:root` custom properties plus `@utility` rules,
  because `--image-*` is not a registered Tailwind v4 namespace and a `bg-gradient-*` class
  would silently emit nothing.
- **Illustrations are CC0 and vendored.** Open Peeps SVGs live in `packages/ui/illustrations`
  and are copied into each portal's `public/` by `sync:illustrations`. They are decorative by
  default (`aria-hidden`) and only announced when a `label` is passed.

## 9. Development environment

- Dev hostnames are `*.localtest.me` (resolves to `127.0.0.1`), so `teacher:3000`,
  `student:…`, `ops:…` and `api:4000` share one registrable domain and therefore one
  `Domain=localtest.me` session cookie. This is the reason auth will work across portals in
  development exactly the way it will in production, with no CORS or localhost hacks.
- Two databases: `lms` for development, `lms_test` for tests, owned by a least-privilege
  `lms` role with `CREATEDB` (Prisma needs it for migration shadow databases). The test
  global setup **refuses to run** unless `DATABASE_URL` names `lms_test`, and redacts
  credentials in the error, because the cost of pointing a suite at the dev database is a
  Saturday morning.

## 10. Verification

`bun run verify` is the gate: shared build → typecheck → lint → tests, across every package.

Tests are written first and are expected to fail before implementation exists. The API
suite boots the real `AppModule` through supertest, so guards, filters, prefix, CORS and
validation are exercised as shipped rather than as mocked; data isolation is a transaction
rolled back per test. Migrations are applied to `lms_test` automatically, and the Prisma CLI
is only spawned when a migration is genuinely missing.

A phase is not "done" when the code compiles. It is done when the tests pass, the browser
behaviour has been checked by hand, and the next phase has been approved.
