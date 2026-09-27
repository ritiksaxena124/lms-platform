# LMS Platform POC — Teacher Marketplace

A marketplace where learners book 1:1 and group sessions with independent teachers.
Three portals (teacher, student, ops) share one API, one database and one component
library.

**Status: Phase 4 done** — accounts sign in, hold a session and a teacher can save a
profile and write, publish and archive courses in the teacher portal (`/courses`, backed by
`/api/v1/courses`), order a course's syllabus of modules (`/courses/[id]/modules`, backed by
`/api/v1/courses/:id/modules`), and write the lessons inside a module — the page, its rough
length, its slot in that block's order, its own draft/published flag and whether one of them is
free to read before enrolling
(`/courses/[id]/modules/[moduleId]/lessons`, backed by `/api/v1/modules/:moduleId/lessons`).
A stranger can already browse what that makes readable, on a second portal:
<http://student.localtest.me:3001> is the shelf (`/api/v1/catalog/courses`) and a course's
outline (`/api/v1/catalog/courses/:id`, and the same course by its slug) — titles, order and
rough length, plus one page a teacher left open to read — on screen at
`/courses/[id]/lessons/[lessonId]`, backed by `/api/v1/catalog/courses/:id/lessons/:lessonId` —
and no account needed to look. Enrollment is in on both sides now: a student can take a place in a
published course, list the courses they are inside and leave one (`/api/v1/enrollments`), and both
catalog routes above answer a stranger and an enrolled student — the page opens, and each outline
row says whether it is a door (`isReadable`) beside what the teacher marked free (`isFreePreview`).
One pair of routes, so there is only one list of gates to keep. The student portal has a session
of its own now (`/login`, `/register` on :3001) and sends it on the reads whose answer depends on
who is asking. That session is on screen too: an enroll button on a course outline, the outline
rows it unlocks, a lesson that reads like a member's page, and a `/my-courses` shelf where a place
can be left. The teacher's side of the same table is on both ends now:
`/api/v1/courses/:courseId/roster` names who holds a place in a course they own and the day they
took it, and the portal shows it at `/courses/[id]/roster` — a headcount, a name and a day per
row, and no button that removes somebody. A course can now carry a price the teacher sets in the
editor and the shelf prints — a quote rather than a checkout (`PAYMENT_PROVIDER` is still `none`),
stored as minor units plus a `Currency` lookup value, `null` when nobody has quoted it and `0` when
the teacher says free, and enrollment still grants a place for nothing. A calendar sits on top of
all that now. A teacher keeps weekly windows open (`/availability`, `/api/v1/availability/rules`)
and can give a live course a trial-call switch (`/api/v1/courses/:id/demo-bookings`); a student
inside that course — or a stranger taking the one trial the teacher allows — sees the teacher's
next 30 days as minutes to ask for (`/courses/[id]/book`, `/api/v1/bookings/slots`). The ask waits
in the teacher's `/requests` queue as `pending` until it is confirmed or refused, and nothing is a
class until that answer. Both sides then read the same rows in their own clock: `/classes` for the
teacher, `/my-classes` for the student, who can also leave. Live video, the action log, the ops
portal and coupons are still ahead.
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
cp apps/teacher/.env.example apps/teacher/.env.development   # where the portal finds the API
cp apps/student/.env.example apps/student/.env.development   # the same, for the public shelf

# 2. Database (roles and databases are created once, by hand, on the local server)
bun run --filter @lms/api db:generate
bun run --filter @lms/api db:migrate
bun run --filter @lms/api db:seed       # reference rows + the three demo accounts below

# 3. Everything else is derived from those two files
bun run verify        # build + typecheck + lint + test across the workspace
bun run dev           # API on :4000, teacher portal on :3000, student shelf on :3001
```

Open <http://teacher.localtest.me:3000> for the portal a teacher works in and
<http://student.localtest.me:3001> for what a stranger sees of that work.
`*.localtest.me` resolves to `127.0.0.1` and gives every portal a subdomain of one
registrable domain, which is what lets the three apps share a session cookie in development
without `localhost` CORS hacks. One shared cookie means one signed-in account per browser
profile: open a second profile (or a private window) to watch the same course as the teacher
who published it.

### Signing in

`db:seed` also creates three accounts. Their password is not a secret — being easy to type
is the entire reason they exist:

| Account                | Portal                                                   |
| ---------------------- | -------------------------------------------------------- |
| `teacher@example.test` | teacher portal                                           |
| `student@example.test` | student portal                                           |
| `ops@example.test`     | ops portal — the role the sign-up form will not hand out |

All three sign in with `lms-demo-password`, at <http://teacher.localtest.me:3000/login> —
the sign-in form has a button that fills the teacher one for you. The student portal has its own
sign-in at <http://student.localtest.me:3001/login> and still opens on the shelf, because a shelf
asks nothing of whoever walks up to it. Accounts are created only in `lms` and `lms_test`: seeding
refuses when `NODE_ENV=production`, and re-running `db:seed` after you have changed one leaves it
changed.
The addresses sit under the reserved `.test` domain, so a demo account can never be pointed at
a real mailbox.

### Walking the demo

Phase 3 is easiest to see as one course travelling from a teacher's page to a stranger's shelf.
Because the portals share one session cookie, use **two browser profiles** (or one private
window) so the teacher and the student are signed in as different people at the same time.

**As the teacher** — <http://teacher.localtest.me:3000>, sign in with `teacher@example.test`:

1. `/courses` → _New course_. Give it a title and a level, leave the price empty; _Save draft_
   puts it on the list. The editor is the only place a course is written — a published course
   reads back locked, and the fields refuse a change the server would refuse anyway.
2. Open it → _write its syllabus_. Add modules and drag them into order; open a module and write
   its lessons — a page of body text, a rough length, and the _free to read_ switch on one lesson
   so a stranger gets a sample before committing.
3. Back on the editor, fill the summary and description the publish check asks for, and quote a
   price if you want one (`4999` + _Indian rupee_ prints as `₹4,999.00`; _No price_ stays empty,
   which is not the same as `0` = free). _Publish_ puts the course on the shelf — and the API, not
   the button, decides whether it was ready.
4. `/courses/[id]/roster` shows who later takes a place: a headcount, a name and a day per row,
   and no button that removes somebody.

**As the student** — <http://student.localtest.me:3001>, in the second profile:

1. The shelf opens with no sign-in: browse published courses by level, each card printing the
   price the teacher quoted. Open a course to read its outline — modules, lessons, lengths — with
   the one page the teacher left open readable, and every other row marked as a door it will not
   yet open.
2. _Sign in_ (`student@example.test`) and the same outline changes character: an _Enroll in this
   course_ button appears, and taking a place unlocks the locked rows. A page flips from a free
   preview to a member's page the moment you are inside.
3. `/my-courses` lists the courses you hold a place in, and lets you leave one. Back in the
   teacher's profile, `/courses/[id]/roster` now names you.

That is the whole loop Phase 3 closes: a teacher writes and prices a course, a stranger reads
enough of it to want it, enrolling turns that want into a place, and both sides see the same
decision.

**Then the same course, as a class to book** — Phase 4's loop, still in the teacher's course page
and the student's:

1. As the teacher, `/availability`: a window is four numbers — weekday, opens, closes, how long a
   class runs — and the week is kept in the teacher's own timezone. Save one and the grid below it
   fills with the minutes that window offers over the next thirty days.
2. Still as the teacher, open the course row: _Offer trial calls_ is the switch that lets a
   not-yet-enrolled reader book one class from this course, once, ever. Leave it off if the loop
   you want to see is the enrolled one.
3. As the student, `/courses/[id]/book` is now a real page: the teacher's open minutes, each one
   labelled with the caption "Times are the teacher's clock". Pick one and ask. It is not booked —
   the minute is held, and the words say so.
4. As the teacher, `/requests` has the ask: one row, one student, one minute. Confirm it and the
   row leaves the queue; refuse it and the minute goes back on the calendar for whoever asks next.
   `/classes` holds the answer either way, soonest first.
5. As the student, `/my-classes` shows the same class in your own timezone — and _Leave this
   class_ gives the minute back while it still stands.

## Commands

| Command               | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `bun run verify`      | The gate: shared build, typecheck, lint, tests. Run before every commit. |
| `bun run dev`         | API + teacher portal + student shelf together.                           |
| `bun run dev:api`     | NestJS API with watch mode.                                              |
| `bun run dev:teacher` | Next.js teacher portal.                                                  |
| `bun run dev:student` | Next.js student portal — the public catalog.                             |
| `bun run dev:ui`      | Storybook for `@lms/ui` on <http://localhost:6006>.                      |
| `bun run test`        | All test suites (Vitest, per workspace package).                         |
| `bun run format`      | Prettier over TS/TSX/JSON/MD. `schema.prisma` uses `prisma format`.      |

## Layout

```
apps/
  api/        NestJS modular monolith — the only writer to the database
  teacher/    Next.js App Router portal for teachers — courses, syllabus, the week, the queue
  student/    Next.js App Router portal for learners — shelf, outline, places and classes
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

Five rules outrank taste:

- **One typeface.** Inter Variable, 100–900, self-hosted from
  `@fontsource-variable/inter/opsz.css` and imported by `@lms/ui/styles.css`. Portals add no
  font request of their own.
- **Borders separate, surfaces stack.** Flat layout gets a 1px line. The only shadow in the
  system (`--shadow-overlay`) belongs to things that float: menus, dialogs, toasts.
- **Colour is meaningful.** Graphite neutrals do the structural work; brand emerald marks
  the primary action; semantic tones stay in their own hue families.
- **Text tokens pass AA at the size they are used at.** `src/styles/tokens.test.ts`
  re-derives every ink and accent contrast against both surfaces, so a gray cannot be
  lightened by eye later.
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

| Phase | Scope                                                                     | Status      |
| ----- | ------------------------------------------------------------------------- | ----------- |
| 0     | Plan, architecture, data model                                            | Approved    |
| 1     | Monorepo, API foundation, DB + Prisma, shared, UI kit, shell              | **Done**    |
| 2     | Auth, accounts, roles, teacher profile                                    | **Done**    |
| 3     | Courses, lessons, enrollment                                              | **Done**    |
| 4     | Availability, bookings and scheduling across timezones — with a calendar  | **Done**    |
| 5     | Video + storage behind provider ports — Jitsi classes, uploaded lessons   | In progress |
| 6     | Email notifications behind the SMTP port                                  | Not started |
| 7     | Action log — who did what, to what, in which part of the app              | Not started |
| 8     | Ops portal — moderation and the read-side of everything above             | Not started |
| 9     | Coupons and payments — teacher-issued codes, redeemed on enrollment       | Not started |
| 10    | The teacher's calendar — a course's class series, holidays, no-class days | Not started |

Phase 4 is closed: the availability rules, the slot grid and the booking lifecycle are shipped
and tested (ARCHITECTURE.md §13 and §14), and both portals show them — the teacher's week,
request queue and class list, the student's booking page and own calendar. Phase 5 has begun
underneath that, one brick at a time: the storage port is real, a lesson can name the bytes of
a recording, and a teacher can attach one to a page of their own — the route decides it is their
page before it reads a byte of the body (ARCHITECTURE.md §6 and §10). The Jitsi rooms and both
portals' players are still to come. What is left of Phases 5–10 is the ordered backlog: a
live class needs a booked slot to attach to, which is why booking came first, the action log
wants every kind of write to exist before it fixes what a record looks like, and
coupons land last among the things a student touches, because a discount only means something
next to a price that is charged — the same reason they sit after the portals are complete. The
calendar work is after all of it: a teacher marking a course's classes to repeat weekly, and
marking the days they are on holiday so no minute is offered on them, are both edits to what
§13's windows mean, and that shape is only worth changing once the booking loop, the video
inside it and the portals around it are settled.

## Environment variables

`apps/api/.env.example` documents every variable. Four are worth knowing early:

- `JWT_SECRET` has **no default and no fallback** — sign-in is impossible without it, and a
  per-process random one would boot cleanly then log everyone out on the next restart.
  Generate with `openssl rand -hex 32`.
- `COOKIE_DOMAIN=localtest.me` is what lets one login cover all three portals. Left unset
  the session cookie belongs to the API host alone.
- `PAYMENT_PROVIDER` and `VIDEO_PROVIDER` default to `none` and are still unset work: video
  is planned as Jitsi (a live class, plus a teacher's uploaded lesson through
  `STORAGE_PROVIDER`) in Phase 5, and money — with the coupon codes a teacher issues per
  course — is Phase 9. The ports exist so neither costs a refactor when it lands.
- `STORAGE_PROVIDER=local` writes uploads under `apps/api/storage/` (gitignored). They have no
  URL of their own: a route that has already checked who is asking streams them back, so there is
  no public directory to leak a paid lesson through. `s3` is rejected at boot until it is
  actually implemented.
