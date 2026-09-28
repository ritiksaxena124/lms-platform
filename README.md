# LMS Platform POC — Teacher Marketplace

A marketplace where learners book 1:1 and group sessions with independent teachers.
Three portals (teacher, student, ops) share one API, one database and one component
library.

**Status: Phase 5 done** — a teacher writes a course and opens a week in it, a learner reads enough
of that course to want a place, asks for a minute of the teacher's time, and is let into a room for
it when the teacher says yes. Everything listed under [What each portal
does](#what-each-portal-does) is shipped, tested and clickable; the action log, the ops portal,
email and money are still ahead, and [Phases](#phases) keeps the ordered record of why.

## Contents

| Section                                                           | What it covers                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| [What each portal does](#what-each-portal-does)                   | The routes that exist today, by the door they are reachable  |
| [Prerequisites](#prerequisites)                                   | The three tools this repo needs                              |
| [First run](#first-run)                                           | Environment, database, seed, and the ports the apps answer   |
| [Signing in](#signing-in)                                         | The three demo accounts `db:seed` writes                     |
| [Walking the demo](#walking-the-demo)                             | The same course, from a teacher's page to a stranger's shelf |
| [Commands](#commands)                                             | The gate, the dev servers, the release                       |
| [Releases](#releases)                                             | What a tag means here, and how one is cut                    |
| [Layout](#layout)                                                 | The five workspace packages and what each one owns           |
| [Design system — Graphite](#design-system--graphite)              | The five rules that outrank taste                            |
| [Conventions](#conventions-that-are-enforced-not-documented-away) | The four rules ESLint holds                                  |
| [Phases](#phases)                                                 | The twelve, their status, and why that order                 |
| [Environment variables](#environment-variables)                   | The four worth knowing early                                 |

## What each portal does

### The teacher's portal

- **Courses** — `/courses`, backed by `/api/v1/courses`. Title, level, summary, description and a
  price, then the draft/published/archive lifecycle. The editor is the only place a course is
  written: a published course reads back locked, and the fields refuse a change the server would
  refuse anyway.
- **The syllabus** — `/courses/[id]/modules` (`/api/v1/courses/:id/modules`) for the modules and
  their order, `/courses/[id]/modules/[moduleId]/lessons`
  (`/api/v1/modules/:moduleId/lessons`) for the lessons inside one: the page of body text, its rough
  length, its slot in that block's order, its own draft/published flag, and whether one of them is
  free to read before enrolling.
- **A price, as a quote** — set in the editor, printed on the shelf, stored as minor units plus a
  `Currency` lookup value: `null` when nobody has quoted it, `0` when the teacher says free.
  `PAYMENT_PROVIDER` is still `none`, so enrollment grants a place for nothing.
- **A roster** — `/courses/[id]/roster` (`/api/v1/courses/:courseId/roster`) names who holds a place
  in a course they own and the day they took it: a headcount, a name and a day per row, and no
  button that removes somebody.
- **The week** — `/availability` (`/api/v1/availability/rules`). A window is four numbers — weekday,
  opens, closes, how long a class runs — kept in the teacher's own timezone, and the grid below it
  fills with the minutes that window offers over the next thirty days.
- **The queue, and the classes** — an ask lands in `/requests` as `pending` and holds the minute;
  nothing is a class until the teacher confirms or refuses it. `/classes` holds the answer either
  way, soonest first.
- **A room, while the class is live** — a confirm gives the class its own Jitsi address, minted from
  a uuid, stored and never sent. A class row grows a Join button inside the window that door opens
  in, and opens it in a frame rather than a link.
- **A recording on a lesson** — attached, named, replaced and played from the same panel that edits
  the page it belongs to.
- **Trial calls** — `/api/v1/courses/:id/demo-bookings` grants a course the switch that lets a
  not-yet-enrolled reader book one class from it, once, ever.

### The student's portal

- **A shelf that asks nothing** — <http://student.localtest.me:3001> is
  `/api/v1/catalog/courses`: published courses browsable by level, each card printing the price the
  teacher quoted, with no account needed to look.
- **An outline, to a stranger and to a member** — `/api/v1/catalog/courses/:id`, by id or by slug:
  titles, order and rough length, plus one page a teacher left open to read. Each row carries two
  flags because they answer two questions — `isFreePreview` is the teacher's statement about the
  page, `isReadable` says what _this_ caller will be handed. One pair of routes, so there is only
  one list of gates to keep.
- **A lesson page, and the recording on it** — `/courses/[id]/lessons/[lessonId]`, backed by
  `/api/v1/catalog/courses/:id/lessons/:lessonId`. The response that sent the text also names the
  file and says how big it is, so the size is printed before a byte is asked for; the bytes go out
  only to a reader the catalog admits, piece by piece so the player can seek.
- **A session of its own** — `/login` and `/register` on :3001, sent on the reads whose answer
  depends on who is asking.
- **Places** — an enroll button on a course outline, the locked rows that become links once it is
  pressed, and `/my-courses`, the shelf of courses the student is inside, where a place can be left.
  All of it is one table on the API's side: `/api/v1/enrollments`.
- **Classes** — `/courses/[id]/book` shows the teacher's next thirty days as minutes to ask for
  (`/api/v1/bookings/slots`), under the caption "Times are the teacher's clock"; `/my-classes`
  shows the same class in the student's own timezone, _Leave this class_ gives the minute back
  while it still stands, and Join opens the room for the class happening now.

The action log, the ops portal, email and coupons are still ahead — [Phases](#phases) says in which
order they arrive.

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

The demo is one course travelling: from a teacher's page to a stranger's shelf, from the shelf to a
booked minute, and from that minute to a room and a recording. Each loop below is the same course
one phase further along. Because the portals share one session cookie, use **two browser profiles**
(or one private window) so the teacher and the student are signed in as different people at the
same time.

#### As the teacher

<http://teacher.localtest.me:3000>, signed in as `teacher@example.test`:

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

#### As the student

<http://student.localtest.me:3001>, in the second profile:

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

#### Then the same course, as a class to book

Phase 4's loop, still in the teacher's course page and the student's:

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

#### Then the class itself, and the recording on a page

Phase 5's loop. It needs the seeded teacher's availability to put a class within reach of the
clock, so book one for the next few minutes and confirm it from `/requests`:

1. As either account, the class row grows a **Join** button inside the window the door opens in —
   five minutes before the class to fifteen after it ends. Before that the row says when it opens;
   after, that it is shut. Pressing Join asks the API for the address and opens the room in a frame
   in the page: there is no link to copy, and a class confirmed before this phase has no room at
   all.
2. As the teacher, open a lesson's panel and attach a video file. The panel prints its name and
   size, and a second upload replaces it — the old recording is retired, not deleted.
3. As the student, that lesson's page prints the same name and size with a **Play** gate in front
   of them. Nothing is fetched until the press, and what comes back is the page's own bytes over
   the page's own door: a locked page refuses the video the same way it refuses the text.

Two things this demo needs to know: the file has to be one the browser decodes — an H.264 MP4 —
because the platform stores bytes and does not transcode them; and a room is only as private as its
name, so `JITSI_DOMAIN` and the minted room name are the whole lock, which is why no list, log or
link carries an address.

## Commands

| Command               | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `bun run verify`      | The gate: shared build, typecheck, lint, tests. Run before every commit. |
| `bun run dev`         | API + teacher portal + student shelf together.                           |
| `bun run dev:api`     | NestJS API with watch mode.                                              |
| `bun run dev:teacher` | Next.js teacher portal.                                                  |
| `bun run dev:student` | Next.js student portal — the public catalog.                             |
| `bun run dev:ui`      | Storybook for `@lms/ui` on <http://localhost:6006>.                      |
| `bun run test`        | All test suites (Vitest, one package at a time — see ARCHITECTURE §17).  |
| `bun run format`      | Prettier over TS/TSX/JSON/MD. `schema.prisma` uses `prisma format`.      |
| `bun run release`     | Cut a tagged GitHub release: verify, tag, push, publish.                 |

## Releases

A release is a phase boundary, not a deploy. `main` carries work in flight; a tag says
"this commit passed the gate", and the tag is what a demo, a hand-off or a rollback points
at. Versions track the phase table below — Phase 5 closed at `v0.5.0` and Phase 6 at `v0.6.0`;
`v0.7.0` will be Phase 7.

```
bun run release v0.7.0 --title="Phase 7: the action log"
bun run release v0.7.0 --notes="What a person gets at this tag."   # instead of generated notes
bun run release v0.7.0 --dry-run
```

`scripts/release.mjs` refuses a dirty tree, a branch that is not `main` and a tag that
already exists on origin; runs `bun run verify` and stops if it is not green; then writes an
**annotated** tag (the message is the title, so `git show v0.7.0` explains the decision),
pushes `main` and the tag, and opens the GitHub release with `gh`. Nothing is pushed unless
the gate passed first, and `--skip-verify` exists only for a tag that is being moved after a
mistake — a tag with no gate behind it is a label rather than a release.

Releases need `gh auth login` once, and the repository's `LMS_PLATFORM` remote over SSH.

## Layout

```
apps/
  api/        NestJS modular monolith — the only writer to the database
  teacher/    Next.js App Router portal for teachers — courses, syllabus, the week, the queue
  student/    Next.js App Router portal for learners — shelf, outline, places and classes
packages/
  shared/     Framework-free TypeScript: error codes, lookup codes, money, timezones
  ui/         Design tokens, primitives and motion shared by all three portals
scripts/
  release.mjs Tag a phase boundary, push it, publish the release
```

`@lms/shared` is consumed as compiled CommonJS by the API and as source by the apps
(`transpilePackages`). `@lms/ui` is always consumed as source — it ships no build step,
which is why editing a component hot-reloads in the portal.

| Package        | Owns                                                       | Dev address                           |
| -------------- | ---------------------------------------------------------- | ------------------------------------- |
| `@lms/api`     | Every route, every write, and the database's only owner    | <http://api.localtest.me:4000/api/v1> |
| `@lms/teacher` | The teacher's work: courses, syllabus, the week, the queue | <http://teacher.localtest.me:3000>    |
| `@lms/student` | The reader's work: shelf, outline, places, classes         | <http://student.localtest.me:3001>    |
| `@lms/ui`      | Tokens, primitives, motion, illustrations                  | Storybook on <http://localhost:6006>  |
| `@lms/shared`  | Error codes, lookup codes, money, timezones                | — a library, not a server             |

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
| 5     | Video + storage behind provider ports — Jitsi classes, uploaded lessons   | **Done**    |
| 6     | Email notifications behind the SMTP port — the queue reached an inbox     | **Done**    |
| 7     | Action log — who did what, to what, in which part of the app              | Not started |
| 8     | Ops portal — moderation and the read-side of everything above             | Not started |
| 9     | Coupons and payments — teacher-issued codes, redeemed on enrollment       | Not started |
| 10    | The teacher's calendar — a course's class series, holidays, no-class days | Not started |
| 11    | Product website — the public face of the marketplace                      | Not started |
| 12    | Docs site — guide, data model, API reference and the phase record         | Not started |

### All twelve, in order

The table is the index; this is what each one is for. Phases 0–6 are shipped, the last of them with
its letters read back out of a mailbox that is not a test double, and 7–12 are the ordered
backlog — each one sits where it does because of what it needs to exist before its shape stops
moving.

- **Phase 0 — the plan.** The decisions every later phase inherits, and the reason for each:
  one API, three portals, nothing ever destroyed, UTC in storage and the reader's zone on screen,
  lookup tables rather than enums, and one envelope for every failure. Approved before any code was
  written, and recorded in `ARCHITECTURE.md`.
- **Phase 1 — the ground under it.** Bun workspaces; the Nest modular monolith answering under
  `/api/v1`; Postgres with `lms` and `lms_test` and Prisma owning the schema; `@lms/shared` with no
  framework in it; `@lms/ui` as the Graphite system with Storybook; and the teacher app's frame.
- **Phase 2 — an account.** Registration behind a hashing port, login with refresh-token rotation,
  the session endpoint, role guards, the teacher's profile, and the three demo accounts `db:seed`
  writes. A session that one cookie lets three portals share.
- **Phase 3 — the thing a teacher sells.** Course, module and lesson with their publish gates; the
  public catalog a stranger can browse without signing in, including the one page a teacher leaves
  open; a student portal that signs in, takes a place and leaves it; the teacher's roster; and a
  price as a quote rather than a checkout.
- **Phase 4 — the calendar.** Weekly windows a teacher keeps open in their own timezone, expanded
  into a rolling 30-day grid of minutes to ask for; an ask that holds the minute as `pending` until
  the teacher confirms or refuses it; a sweep that ends the ones nobody answered; the trial call a
  course can opt into; and both portals' screens, with the `Calendar` primitive in `@lms/ui`.
- **Phase 5 — the class itself.** Video and storage behind their ports: a room minted for a
  confirmed class and handed out only inside its window, and one recording per lesson that streams
  through the same gate as the page's text. Detailed below.
- **Phase 6 — the news.** Email behind the SMTP port: the lifecycle of Phase 4's bookings said out
  loud to the person it happened to. Transport, renderer, queue, send decisions, the sweep and a
  mailbox that received them are all in.
- **Phase 7 — the action log.** Who did what, to what, and in which part of the app — an
  append-only record the API writes beside its own business writes. It waits until every kind of
  write exists, because a record's shape is only worth fixing once.
- **Phase 8 — the ops portal.** The third app, `ops.localtest.me:3002`, for the role the sign-up
  form will not hand out: moderation and the read-side of everything above it, including the outbox
  Phase 6 fills and the log Phase 7 writes.
- **Phase 9 — money.** Coupons a teacher generates per course, each with its own discount and its
  own run-time, redeemed on enrollment, and `PAYMENT_PROVIDER` ceasing to be `none`. Last among the
  surfaces a student touches, because a discount only means something beside a price that is
  charged.
- **Phase 10 — the teacher's calendar.** A course's classes repeating weekly, and the holidays and
  no-class days that stop minutes being offered at all. Both are edits to what §13's windows mean,
  so they come after booking, video and both portals have settled.
- **Phase 11 — the product's face.** A public website a school or a teacher reads before anybody
  signs up: an `apps/*` workspace member on `@lms/ui` and `@lms/shared`, and not a second backend.
- **Phase 12 — the docs.** The guide, the data model, the API reference and this phase record,
  published from what the code already says rather than restated into a second copy that drifts.

**Phases 0 through 6 are closed.** The first four are the ground the product stands on —
ARCHITECTURE.md carries the reasoning behind each (§6–§14). Phase 5 went one brick at a time, and so
did the news phase after it:

- **Storage.** Bytes are filed with no URL of their own; a lesson names the recording that stands
  behind it, and a replacement retires the previous row rather than deleting it
  (ARCHITECTURE.md §6 and §10).
- **The video port.** A room address built from a name the API mints, with `none` still an adapter
  rather than an `if` in every route. A teacher's yes now gives that class its own room name,
  minted from a uuid, written beside the status, stored and never sent — and every class list
  carries the window its door opens in, so a screen can draw a Join button and say when it works
  (§14).
- **The address, handed out.** One POST, answered only for the two accounts a standing class is
  about and only while its window is open.
- **A recording, watched through the same kind of door.** A page's bytes go out only to a caller
  its own gate admits — a free preview, or a place in the course — and they go out as the piece the
  player asked for, because a `<video>` element seeks rather than downloads (§11 and §14).
- **Both portals now stand on those two doors.** The teacher's carries a recording attached, named
  and played from the same panel that edits the page it belongs to, and a class row that grows a
  Join button inside the window its list already published. The student's lesson page offers the
  recording its own response named — the size printed before a byte is asked for — and
  `/my-classes` opens the room for the class that is happening now, in the student's clock like
  every other time on that screen (§15).

Neither portal puts a room address in a link, in a list, or anywhere a browser keeps it.

**Phase 6 is closed.** It carries the lifecycle notifications and nothing else: the
teacher is told a minute has been asked for, both sides are told how it was answered, and a place
taken or left is said out loud. Money stays where it is. Two decisions shape it. **The layout lives
in code and the copy lives in the database** — a small set of email-safe React primitives renders
each message, while an `EmailTemplate` row keyed by event code holds the subject and the sentences
an operator may want to change without a deploy. A finished HTML document in a row would be markup
no test and no review had ever seen, and one bad edit would break Outlook for every recipient.
**And those components are server-rendered inside the API, not as React Server Components** — the
API is the only writer and the only place a send decision can honestly live, so a React server
boundary in a portal is a preview surface for later rather than the mechanism now. What a mail can
never contain: a room address, a stored key, a token, or an image that needs a public URL — links
go to a portal page that then asks who is calling. Delivery runs off an outbox table and a sweep
rather than inside the request, so a mail vendor being unreachable cannot slow a booking or lose
the news of it. **Step 6a, the transport, is in** (`ARCHITECTURE` §6):
`apps/api/src/providers/mail` answers one question — hand this finished message to a transport —
with `SMTP_URL` as the switch rather than a provider string, because there is one kind of mail
transport to configure. `nodemailer` lives in exactly one file behind a two-word transport the
specs can double; `SMTP_URL` without `MAIL_FROM`, or a URL that is not `smtp://`/`smtps://`, stops
the boot instead of guessing; `NoMail` resolves and says `delivers: false`, so a box with no mail
drops notifications instead of failing requests, and never records a drop as a send; and what a
failure leaves behind is the transport's error code (`EAUTH`, `smtp 550`) rather than its error
text, which names the host and the login.

**Step 6b, the message and the row, is in** (`apps/api/src/modules/notifications`).
`email-primitives.tsx` builds a message out of tables marked `role="presentation"`, a 600px column
whose width is written as an attribute as well as a style because Outlook reads the attribute and
everyone else the style, inline styles only, a button that is a table cell because Word's engine
ignores padding on an anchor, and no image at all — the app's palette reappears here as literals,
and Inter does not, because it is self-hosted in the portals and exists on no reader's machine.
`render-email.tsx` fills one row's `{slot}` names from the payload and writes both bodies from the
same filled strings; the text version is not the HTML with its tags cut out, because that loses the
address behind a button whose label is a sentence. An unfilled slot, a label with no destination, a
destination with no label and an href that is not absolute http(s) are all refused while the message
is being built rather than at the transport, and the refusal names the problem without repeating the
address. `email_template` holds the half an operator edits — subject, heading, a sentence per line,
an optional button label — and `event_code` is unique across every row rather than the standing
ones, so a reword is an update in place and what a message once said is Phase 7's log to hold.

**Step 6c, the queue, is in** (`mail_outbox`). A row holds the news rather than the letter — the
event code, the payload that answers the copy's `{slot}` names, and the account to tell — written in
the same transaction as the change it reports, and rendered when the sweep goes to send it. That
order is what makes a retry able to succeed, and what keeps a notification from being able to fail a
booking: the insert inside the request carries no markup and no template lookup, so an event whose
copy is missing or broken becomes a row that ends up `failed`, not a class that did not happen.
There is no column for an address: the recipient is a `User` reference and the email is read when the
message goes out, so a person who corrected their account is not mailed at the old one. `status` is
a five-word list in `@lms/shared` — `queued`, `sending`, `sent`, `failed`, `dropped`, with `dropped`
kept apart from `sent` because 6a's port promised never to record a throwaway as a delivery — because
a state whose only writer is a scheduler is a step in a program, not reference data an operator
maintains. `nextAttemptAt` is not-null-by-default rather than nullable, since `null` would have to
mean both "never scheduled" and "never again"; `sentAt` is its own column so a retry cannot move the
date a person asks about; and nothing is unique, because the same news legitimately happens twice to
one reader.

**Step 6d, the seven send decisions, is in.** A student asking for a minute, a teacher confirming or
refusing it, a request left to expire, a class the student gave back, and a place in a course taken or
left now each file one outbox row while the write that decided them is still open. The repository
calls the queue and the service names the event, because _when_ the news is filed is a fact about a
transaction and only that transaction knows it, while _which_ event a write is stays where the
vocabulary lives. A replay files nothing — the second press of either button, the loser of a race, a
refused conflict and a leave on a place already closed all answer with the row as it stands and say
nothing new to anybody, and that rule is the reason the notifier is a parameter inside the write
rather than a line after it. The expiry sweep moved to per-row transactions for the same reason: a
bulk update reports a count, and a count cannot be addressed. Every class message is written in its
reader's clock and names the other person, so `when` comes from the recipient's own timezone, and a
join is news to the student alone — a teacher who wants to know who joined reads their roster. The
links those messages carry are built from two new required absolute origins, `TEACHER_PORTAL_URL`
and `STUDENT_PORTAL_URL`, with every interpolated segment encoded, so a notification queued by a
scheduler points at a page on a host the deployment named rather than at a request it has no part in
(§6).

**Step 6e, the sweep, is in** (`mail-delivery.service`). A cron named `mail-outbox-delivery` wakes
every five minutes, takes the twenty-five oldest due rows, writes each letter from the copy standing
that minute and hands it to 6a's port. A row is owned by a status write rather than a lock: the claim
is `queued → sending` with `queued` still in its `where`, so two processes on one database split
the queue rather than both working one row, and a claim whose process died is taken back after fifteen
minutes — wider than a run, keeping the ask it never reported. That is at-least-once, not exactly-once,
and deliberately: a class confirmation is worth repeating when a send cannot be proved, and the
reclaim window is what makes a repeat rare. The claim counts that ask before the transport is touched,
which is what lets the retry wait be read off the row itself: five waits (a minute, five, thirty, two
hours, six) mean at most six asks and a row that stops being asked about inside a day of its news.
What a failure earns is one distinction: only the transport's refusal is worth asking again, because a
host that is unreachable now may not be in five minutes. Everything the renderer or the address book
refused — a two-line subject, an unanswered slot, a payload with no envelope, an event nobody filed
copy for — ends the row, because the input has not changed and a queue that retries a broken sentence
keeps a person from ever being told. An error with no case for it leaves the row alone and the page
carries on, since news that is perfectly sendable should not be written off because of a bug, and one
row's outage should not leave twenty-four people unread. The three terminal writes answer with whether
the row was still theirs, so a letter is never reported sent on a row another process took back; and
on a box with no transport the rows are `dropped` with no ask counted and no reason invented, because
the honest record of an undecided deployment is that its news went nowhere. Addresses are read at
delivery and never logged — a log line carries an event code and a row id — and the sweep's two halves
live in one spec file, because a sweep is global and two files sweeping one queue take each other's
rows (§6).

**Step 6f, the live inbox, is in.** Five rows were filed through the routes themselves — two requests,
a confirmation, a refusal and a place taken — against a dev API whose `SMTP_URL` named an Ethereal
sandbox endpoint, and the cron ran on its own boundary rather than on a test's clock: `Mail sweep: 5
sent, 0 waiting, 0 ended`, with every row `sent` and `attempts = 1`. The letters were then read back
over IMAP, because `api.ethereal.email` has no DNS record on this network and the vendor's own viewer
was unavailable — which turned out to be the stricter witness, since a mailbox returns what a
recipient's client sees rather than what the sender said about itself. Two things about what arrived
are worth writing down. The same class instant read `9:30 am GMT+0` in the teacher's copy and `3:00 pm
GMT+5:30` in the student's, which is 6d's `when` rule observed from outside the code that formatted
it; and a scan of the delivered bytes for a room address, an `Authorization` value, a token or a
connection string finds none, with the only hosts named being the two portal origins the deployment
configured. What a sandbox cannot prove stays unproven: it accepts any recipient whether or not a
mailbox stands behind them, so a wrong address would have read `sent` here too, and the retry curve,
the reclaim and `NoMail`'s drop are shown against doubles in a spec rather than against a host that
refused twice.

**Phase 7 is scoped, not started.** An append-only `action_log` — who did what, to which row, and in
which part of the app — because nothing in this API is audited today: no service logs its own writes,
and the outbox has a recipient but no column for who caused the news. Four decisions give it a shape.
**What earns a row is a write that changed something**, plus the three account events a person later
asks about: signed in, signed out, and the replayed token that ends every session an account has
(ARCHITECTURE §7). The mail sweep's status churn is left out because `mail_outbox` already _is_ that
record, and the token rotation on every portal load is left out because a log a machine floods is a
log nobody reads. **Which part of the app is named by the action rather than by the caller** — a table
in `@lms/shared` gives every action code one section code, so the answer lives with the vocabulary and
never arrives in a header a client could fill in. **A row
remembers the decided facts**: a status from one code to another, a price before and after, a switch
going on. Never a copy of the row it touched, because a snapshot carries personal data forward past
both the correction and the deletion, and grows with every column the table gains — and the room name
a confirming teacher mints is precisely the value that changes a booking and may not change a log
(§14). **The record is written inside the transaction that owns the change**, for the reason Phase 6's
notifier is a parameter rather than a line after the write: a write that rolled back leaves nothing
behind, and a replay that changed nothing records nothing. The actor reaches the write from the request
context the middleware already builds, as an id plus the role as it stood; the target is a table-and-id
pair with no foreign key, because an FK would let a missing row fail the very write it was reporting.
The table has `created_at` and neither `updated_at` nor `isActive` — a mutable column on an append-only
ledger is an invitation to edit history. Phase 7 ends at an ops-gated read endpoint: a log that cannot
be asked a question is not yet a feature, and the screen that draws it is Phase 8's.

**Why that order, and why the rest of it is still in the table.** A live class needs a booked slot
to attach to, which is why booking came before video. The action log wants every kind of write to
exist before it fixes what a record looks like. Coupons land last among the things a student
touches, because a discount only means something next to a price that is charged — the same reason
they sit after the portals are complete. The calendar work is after all of it: a teacher marking a
course's classes to repeat weekly, and marking the days they are on holiday so no minute is offered
on them, are both edits to what §13's windows mean, and that shape is only worth changing once the
booking loop, the video inside it and the portals around it are settled.

Phases 11 and 12 are the two apps that sit outside the product, and they are last for the plainest
reason — a website advertises a thing that has to exist, and a guide written while a phase is still
moving is a guide that gets rewritten. Neither would be a backend: the API stays the only writer to
the database, and a docs page renders what the code already says rather than becoming a second copy
of it that drifts. The table above is the seed for both: it is what the docs site will publish, and
what the website will point at.

## Environment variables

`apps/api/.env.example` documents every variable. Six are worth knowing early:

- `JWT_SECRET` has **no default and no fallback** — sign-in is impossible without it, and a
  per-process random one would boot cleanly then log everyone out on the next restart.
  Generate with `openssl rand -hex 32`.
- `COOKIE_DOMAIN=localtest.me` is what lets one login cover all three portals. Left unset
  the session cookie belongs to the API host alone.
- `TEACHER_PORTAL_URL` and `STUDENT_PORTAL_URL` are the two origins a notification's link is built
  from, and both are required absolute URLs. They are not derived from the request: the sweep that
  sends a message has no request, and a host header is a value somebody else chose. On a laptop,
  `http://teacher.localtest.me:3000` and `http://student.localtest.me:3001` are the honest answers;
  `localhost` in one of them produces mail whose links work only on the machine that sent it.
- `SMTP_URL` is the whole of the mail switch, and `MAIL_FROM` is required beside it. Unset, the box has
  no transport and the queue's rows end `dropped` with nothing asked; set to something that is not an
  `smtp://` or `smtps://` endpoint, the boot stops rather than finding out at the first confirmation.
  A sandbox endpoint is the honest way to watch a letter arrive on a laptop — Phase 6's step 6f read
  its own mail back over IMAP for exactly that reason.
- `PAYMENT_PROVIDER` defaults to `none` and is still unset work: money — with the coupon codes a
  teacher issues per course — is Phase 9, and the port exists so it costs no refactor when it
  lands. `VIDEO_PROVIDER` defaults to `none` too, and is a real configuration rather than a
  placeholder: with `jitsi` and a `JITSI_DOMAIN` (a bare host, `meet.jit.si` unless you name
  another) a class gets a room address; on `none` the same screens say there is no room. A Jitsi
  room carries no password, so the name the API mints is what keeps a class private — see
  ARCHITECTURE.md §6 before putting a room URL anywhere a stranger can read it.
- `STORAGE_PROVIDER=local` writes uploads under `apps/api/storage/` (gitignored). They have no
  URL of their own: a route that has already checked who is asking streams them back, so there is
  no public directory to leak a paid lesson through. `s3` is rejected at boot until it is
  actually implemented.
