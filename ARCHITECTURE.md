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
  open endpoint in production. A route that would rather know who is asking than demand it is
  `@OptionalSession()` — one exists today, §11 — and it still refuses a token that is present
  and broken, so the optional part is only ever about an absent one.
- **The token says who signed in; the row says who they are now.** The guard verifies the
  signature and then re-reads the account for its role and status, so a promotion, a
  demotion and a disable all take effect on the next request instead of on the next login.
  That is one indexed lookup per authenticated request, bought deliberately: without it a
  disabled account keeps whatever it was for up to fifteen minutes.

A portal is a client of that design, and inherits its rules:

- **The browser never stores the access token.** It lives in a module variable in
  `apps/teacher/lib/api.ts`, so a reload has no token to reuse and must trade the cookie for
  one — which is what `POST /auth/refresh` is for, and why `packages/shared/src/auth.ts`
  owns the response shape both sides speak.
- **One refresh at a time.** `refreshSession()` hands every concurrent caller the same
  in-flight promise. Rotation plus replay-detection means three widgets booting in parallel
  would otherwise present the same token three times and end the account's own sessions.
- **Credential endpoints never replay.** `reviveSession: false` on login, register and
  logout: a 401 from them is the answer, and replaying a logout would restore a session
  someone had just asked to end.
- **A refused refresh is announced, not swallowed.** `onSessionLost` lets the chrome drop the
  greeting when a token dies mid-session; the alternative is a header that welcomes someone
  the API no longer recognises.

## 8. Courses

- **A course belongs to exactly one teacher account.** Co-authoring would need a join table
  and a second set of permissions, and a course that can change hands underneath a student
  is a course nobody is accountable for.
- **A slug is unique per teacher, and stays taken after the course is archived.** `intro-to-algebra`
  is a phrase two teachers will both reach for, and a global key hands the second one a fight
  over a word. Retiring a course must not free its address: a link, a screenshot and a
  forwarded message that named it are still in the world.
- **`status` is not a writable field.** The validation pipe rejects unknown properties, so a
  body cannot contain `status`, and the column moves only through `POST /courses/:id/publish`
  and `/archive`. Those two handlers can attach a precondition; a PATCH could not.
- **Publishing checks what a student reads** — a summary and a description — and answers per
  field, so the form can point at the two boxes still empty rather than at the page.
- **A published course cannot be edited.** Archive it first. A student reading a description
  is reading a promise about the classes they enrolled for, and silent changes to it are how
  that promise stops meaning anything.
- **Another teacher's course answers `NOT_FOUND`, not `FORBIDDEN`.** Every read and write
  carries `teacherUserId` in its `where` clause rather than checking ownership afterwards, so
  ownership is not a step a later endpoint can forget. `403` would tell a colleague the id
  exists and is a course.
- **No price on the course row, and no `DELETE`.** Nothing can charge one yet, so a stored
  number would be a field no provider validates and a figure a student can be shown. Retiring
  is archiving; the row is what an enrollment points at (§12), and an archived course keeps a
  roster of the people who were inside it.
- **The teacher writes courses at `/courses`, `/courses/new` and `/courses/[id]/edit`.** One
  list fetched once and filtered locally by status tab, one editor for both create and edit,
  and the lifecycle buttons on the row as well as in the editor — because publishing is what
  a teacher came here to do, and making them open a form to find the button costs a click
  every time.
- **What sits inside a course is §9.** The container has no fields of its own left to decide;
  the syllabus underneath it is where the next rules live.

## 9. Modules

A module is one ordered block of a course's syllabus — the level a lesson will sit under. Its
routes hang off the course (`/api/v1/courses/:courseId/modules`) and it shares the course's
Nest module, repository of ownership and guards instead of standing up a domain of its own.

- **A module has no status of its own.** Whether a student may read one is decided by the
  course's lifecycle, and a second flag would need rules for which of them wins when they
  disagree.
- **`position` is not a writable field.** The API appends at the end of the order. A body that
  could name its own slot could put two modules in it, and the unique index would answer a
  drag-and-drop mistake with a 500.
- **A retired module keeps its slot, and a new one takes the number after the highest the
  course ever used.** `lastPosition` counts inactive rows, so "module 3" in a message sent last
  month cannot come to mean a different block. Gaps in the numbering are the price, and a
  syllabus is read in order rather than by arithmetic on its labels.
- **A reorder permutes the slots the active modules already hold** rather than renumbering from
  1 — the slots retired rows sit on stay theirs. The body must name every active module exactly
  once, or nothing moves at all.
- **The write is two phases inside one transaction.** `uk_module_course_position` is checked as
  each row lands, not at commit, so a straight swap fails on its second row: the first has
  already taken the slot the second still stands in. Every row is lifted above any slot a
  course can reach, then set down.
- **Adding and renaming are allowed while a course is published; removing a block only when it
  holds nothing a student is reading.** A teacher extending a live syllabus gives a student more
  to read. Taking away a block with published pages inside it could remove what they are working
  through, so the answer is `409` naming the lessons to take back first (§11). An empty block —
  or one whose every page is still a draft — is not on a student's screen at all, so a teacher
  tidying up a mistake is allowed to, rather than being told to archive the course.
- **Ownership is inherited rather than repeated.** Every entry point resolves the course against
  the session's own courses first, so a module id alone is never a key: another teacher's
  syllabus is `NOT_FOUND`, whether it is reached through its own course or somebody else's.
- **Deactivating is the only removal, and a lesson goes with its module.** Lessons are reached
  through the module they hang off, so retiring the block takes everything written under it out
  of the syllabus without each lesson row needing its own answer first. Deleting a module
  outright is refused by `lesson_module_id_fkey`, which is the same promise in stronger terms:
  the block a lesson was written for is still there.
- **The teacher edits the syllabus at `/courses/[id]/modules`, and the portal paints only what
  the API confirmed.** A move sends the whole order and repaints from the reply rather than
  swapping two rows locally, so a reorder the server refused cannot leave a syllabus on screen
  that was never written. Adding, renaming and removing all take the same no-optimistic-paint
  rule as the course editor. Each module row links down into its lessons (§10).
- **What sits inside a module is §10.** The syllabus has no fields of its own left to decide.

## 10. Lessons

A lesson is one page of reading inside a module — the thing a student actually opens. Its routes
hang off the module (`/api/v1/modules/:moduleId/lessons`) while it lives inside the Course Nest
module, because ownership is a question the course already knows how to answer and a second
domain module would only re-derive the same two hops.

- **A lesson does have a status of its own, and readability needs both gates.** `LkpLessonStatus`
  carries draft → published, and a page is readable only when its lesson is published *and* its
  course is published: neither flag may expose the other's unfinished work. A module deliberately
  has no flag (§9) — it is a heading, and a heading with an opinion of its own would need rules
  for which of the three wins.
- **The content is one markdown `body`, capped at 20 000 characters.** No embedded video, no file
  attachments, no block editor: those are the shapes that need a provider, and a provider is a
  decision for later. A plain-text body is a column today and one migration away from whatever the
  editor turns out to be.
- **`estimatedMinutes` is shown, never enforced** (1–600, cleared with an explicit `null` rather
  than by leaving the field alone). A teacher's guess at how long a page takes is useful
  information and a promise the platform should not hold anyone to; no timer sits behind it.
- **`isFreePreview` is a column, not a lifecycle stage.** The teacher's "a stranger may read this
  one" — set by `PATCH` and deliberately absent from `POST`, since there is no such stranger
  until the page exists. It is not an `Lkp*` row because it is not a stage something passes
  through: it is one yes-or-no about visibility, it can be turned off as easily as on, and it has
  exactly one place where it is honoured (§11). A draft page can carry the mark, which is a
  teacher planning what the free sample will be; a plan is not a publication.
- **`position` is not writable, and the slot is unique per module** (`uk_lesson_module_position`)
  rather than per course. A course-wide number would make every move inside one module a
  renumbering of the whole syllabus, and lessons are read inside their own block.
- **A retired lesson keeps its number** — `lastPosition` counts inactive rows, so "lesson 3" in a
  message sent last month still means the same page, and gaps in the numbering are the price.
- **A moved lesson is the exception: the number it vacated is not reserved.** The row leaves the
  source module, so that module's `lastPosition` no longer sees it and the next lesson written
  there reuses the slot. The asymmetry is deliberate — the stale-link worry is about a page still
  in the syllabus under a label nobody changed, and a lesson that has gone to another module is
  not that page.
- **Reorder is scoped to one module, permutes the active slots, and demands the whole list.**
  Two phases inside one transaction, because Postgres checks the unique index as each row lands;
  the arithmetic lives in `planSlotMoves`, shared with the syllabus so the swap that fails on its
  second row cannot be re-implemented wrongly in one of the two places.
- **Publishing requires a non-blank body, and answers with a field error on `body`.** An empty
  page is a broken promise to whoever opens it, and "write the page before publishing it" points
  at the box to fix. A body of nothing but whitespace fails the same test.
- **Unpublishing is always allowed; deactivating is refused only for a page a student can read.**
  Going back to a draft hides rather than removes, so it cannot take something away from a student
  working through it. Retiring a row can — but only if it was reachable, which needs both gates
  open at once (§11). A draft page under a live course has never been on a student's screen, so a
  teacher tidying one away is allowed to; refusing that would strand half-written pages in a live
  syllabus with no answer short of archiving the course.
- **Ownership is two hops, resolved before anything is read.** The module is matched against a
  course the session's teacher owns, and the lesson against that module — so another teacher's
  lesson is `NOT_FOUND`, whether it is addressed through its own module or somebody else's, and a
  malformed id is answered by the service before Postgres is asked.
- **The teacher writes pages at `/courses/[id]/modules/[moduleId]/lessons`, reached from a
  module row on the syllabus.** Same no-optimistic-paint rule as the rest: a publish the API
  refused leaves a draft pill on screen, and a reorder repaints from the order that came back.
  Because a lesson has its own flag, the screen says which flag it is showing — the row's pill
  is the lesson, and the course's state is spelled out in words beside the module title rather
  than as a second chip a colour-blind reader has to tell apart.
- **A move is a request of its own, never part of the edit form.** The API treats a body that
  names a module as a move and ignores every other field in it, so a form that sent the edits
  and the move together would lose the edits without saying so. The row's move control sends
  only the module, and the lesson leaves the list because it is no longer this module's page.
- **What a student may read of all this is §11.** The two gates are enforced in one place there,
  rather than being a rule each teacher route has to remember.

## 11. The catalog: what a stranger may read

The catalog is the same course seen by somebody who cannot edit it — `GET
/api/v1/catalog/courses`, `/catalog/courses/levels`, `/catalog/courses/:id` and `/catalog/courses/:id/lessons/:lessonId`, in their own Nest
module (`modules/catalog`) because the question they answer is different in kind: no ownership,
no writes, and — but for the one route below — no session either.

- **It is the only public surface in the API, deliberately.** A shop window has to be readable
  before anybody is asked to sign in, and what it can reach is decided by the rows' own statuses
  plus one relationship. `@Public()` on the controller is the exception that the global guard
  exists to make expensive, so the suite checks the absence of a session as carefully as the
  tests everywhere else check its presence — and the teacher's routes still answer `401` without
  one. Opening a page is a third kind of route, `@OptionalSession()`, and its own bullet below.
- **Both gates are applied here and nowhere else.** A course appears only while it is published
  (`archived` retires it from the catalog exactly as `draft` never admitted it), and a page inside
  it appears only while its own lesson is published too. §10 promised those two flags; this is the
  promise kept. A draft lesson under a live course is invisible here, which is what lets a teacher
  pull one back without touching the course.
- **A block is listed only while it holds something readable, so a card's counts are the detail's
  counts.** `moduleCount` and `lessonCount` on a card count the same rows the course page will
  list, not everything the teacher ever made. A card that promised nine pages and opened onto
  four would teach a student to distrust every number on the screen.
- **The outline never hands over a page; one named endpoint does.** `body` is not selected by
  the syllabus query — a student browsing sees titles, order and each page's rough length, which
  is enough to decide. The exception is `GET /catalog/courses/:id/lessons/:lessonId`, which
  returns a body for a page its caller may open: one the teacher marked `isFreePreview`, or any
  published page of a course they hold a place in. It is one route, not a syllabus row with text
  slipped in, so the outline keeps one shape whether or not any room on it happens to be open.
- **Each outline row carries two flags, because they answer two questions.** `isFreePreview` is
  the teacher's statement about the page — true whether or not anybody is signed in, and worth a
  badge. `isReadable` is about the reader: it says the page route will hand *this* caller the
  body. For a stranger they agree; for a student holding a place every published row reads true
  while the teacher's marks stay put. A screen links what `isReadable` says and badges what
  `isFreePreview` says, which is the only way the same component can be honest to both readers
  without either one being inferred from the other.
- **`isFreePreview` is a door, not a third visibility gate.** A page marked free still appears on
  the syllabus exactly as it did when it was locked, and a page that is free but still draft, or
  inside a course nobody published, appears nowhere and reads nothing. The flag decides whether
  the body can be opened; the two published statuses decide whether the row is on the shelf at
  all. A student's place opens the same door for their own pages — and opens no door the
  statuses shut, which is why enrolling cannot reach a draft. All of it is one Prisma `where`,
  so a route cannot honour the door and forget the wall behind it.
- **`@OptionalSession()` is for the routes that read who is calling without demanding it** — a
  course's outline and one of its pages. The alternative was a second endpoint that repeats these
  gates for a signed-in student, and a copy of a gate is a gate that drifts. Three rules keep it
  honest: a request with no header is a stranger rather than a refusal; a header that is present
  and broken is refused exactly as on a protected route, because quietly answering "you are a
  visitor" would let an expired session read an enrolled student's pages forever while the refresh
  path never ran; and the handler asks for the caller with `OptionalCurrentUser`, the only
  decorator in the API allowed to answer `undefined`. Where the answer is worth a page's text it
  goes inside the same `where` as the publish gates; where it only colours a flag on rows that are
  published already, it is a probe beside the read — a wrong answer there can never reveal a
  draft, and the syllabus query stays the single statement of what is on the shelf.
- **`NOT_FOUND` is one answer for several cases.** An unpublished course, a retired one, a slug
  nobody typed and an id that never existed all read the same; so do a locked page, a draft page,
  a published page of a course the caller is not inside, and a page that is not inside the course
  named in the path. A malformed id is caught in the service before Postgres is asked. A catalog
  that distinguished them would be a list of other people's drafts — and a `403` on a locked page
  would be a catalogue of what to enroll for. The same silence has to hold with a session in the
  hand, or the answer "sign in first, then we can tell you" leaks a syllabus to exactly the
  people curious enough to make one.
- **Paged, filtered, and searchable by the two fields a card shows.** `level` is a `CourseLevel`
  lookup code resolved at the edge (an unknown one is a field error, not an empty page), `q`
  matches title or summary — never the description, because a hit the list cannot explain is a
  worse result than no hit — and `page`/`pageSize` are validated as numbers so a query string
  comparing `'2'` to `2` cannot be a bug later. Newest first, since a ranking this phase has no
  signal for would be a guess with a sort button on it.
- **The student portal is its first consumer**, at `apps/student`: the shelf at `/` and a
  course's outline at `/courses/[id]`. A course read now takes either the id the API issued or
  the slug its author chose — a slug is the nicer thing to put in a link somebody else will
  paste — and the two must return the identical body, which is a test rather than a hope. The
  portal still links by id, the field every catalog response has always carried and the one a
  retitling cannot move. The outline prints each module's position as the catalog sent it, gaps
  included, and a lesson title is a link only on a row the response marks `isReadable` — which is
  the teacher's free pages for a visitor and every published page for a student who is signed in
  to this portal and holds a place, because that is exactly what its transport now sends. The
  page itself is a second request
  (`/courses/[id]/lessons/[lessonId]`, `components/course-lesson.tsx`), so the syllabus keeps one
  shape whether or not any room on it is open — and the screen has to be one screen, because two
  doors now reach the same page: a teacher's free page and a place the student holds. It says which
  door it came through in its closing line, and a refusal to show a page keeps the API's single
  `NOT_FOUND`, since a message that named the reason would be a list of what to enroll for.
- **Both audiences are the catalog's.** A stranger reads the pages a teacher left open; a student
  holding a place reads every published page of that course too (§12). One query answers both,
  which is the only reason the second is not a superset of the first by accident.

## 12. Enrollment

An enrollment is one row saying one thing: this student holds a place in this course. It is
the join the rest of Phase 3 has been pointing at — a free page is an invitation, and this is
what an invitation is for.

- **One place per student per course, and leaving does not put it up for grabs.**
  `@@unique([courseId, studentUserId])` covers the pair rather than the student, because a
  second course is a second decision. Quitting sets `isActive` false and the pair stays
  claimed; coming back reopens the same row, which is why `createdAt` is the day a student
  first enrolled and not the day they returned. Same reasoning a retired module keeps its
  number: a record that changes meaning when read twice is worse than no record.
- **An enrollment is never deleted, for the reason §2 gives and then some.** The row is why a
  student could open the pages they already worked through, so erasing it would erase the
  evidence of an access that happened.
- **The table decides nothing about who may join.** The course has to be published to take a
  place, and that is a rule the endpoint enforces — as a constraint it would freeze something a
  lookup row is meant to be able to change.
- **Two indexes, one per question.** `ix_enrollment_student_list` answers "my courses", newest
  first, and `ix_enrollment_course_roster` answers a teacher's headcount and the gate's own
  lookup — "is this student inside this course" has to be an index probe, not a scan.
- **Three routes, a student's and nobody else's.** `GET /api/v1/enrollments` is "my courses",
  `POST /api/v1/enrollments` takes a place by `courseId`, and `POST
  /api/v1/enrollments/:id/cancel` closes one. They live in `modules/enrollments`, and what a
  place is *worth* stays the catalog's decision — this module writes the row §11 reads.
- **The role is the whole of "a teacher cannot enroll in their own course."** The controller is
  `@Roles(STUDENT)`, so that request never reaches a query to be checked. When a later phase
  wants teachers to take places too, the decorator is the one line that changes, and the
  ownership question it would raise is a decision somebody makes on purpose rather than a hole a
  service forgot to plug.
- **Both writes are idempotent and both answer `200`.** Enrolling twice returns the row that
  already exists, with its original `enrolledAt`; cancelling a closed place returns it closed. A
  button on a slow connection gets pressed twice, and a `201` with a second row — or a `409` the
  portal has to interpret — is the API handing that problem to the client.
- **A student's place is worth pages through the catalog's own routes.** §11 folds it into the
  page query's `where` as the alternative to `isFreePreview`, and answers it as a probe beside the
  outline read to set each row's `isReadable`, which buys the things the suite checks directly:
  enrolling cannot reach a draft or a retired page, leaving cannot close a page the teacher left
  open, and the outline the student sees opens on exactly the rows the page route will hand over.
  A separate "read as an enrolled student" endpoint would have had to remember both.
- **A retired course closes on the students inside it.** `archived` drops its pages for them
  exactly as it drops the course from the shelf, and the course leaves "my courses" so the portal
  is never handed a link to a page that will not open. The enrollment row stays: §2 covers the
  access as much as the record of it.
- **`enrolledAt` is the row's `createdAt`,** sent as an ISO instant like every other timestamp
  here. It names the first day a student took a place, not the day they came back to it — the
  reason this table keeps one row per pair.
- **What holds it:** `apps/api/test/enrollment-schema.spec.ts` for the table's promises,
  `apps/api/test/enrollments.spec.ts` for the routes, the gate they open, the outline rows they
  light up and the silence they keep. The student portal reads all three now — `lib/enrollments.ts`
  for the transport, `EnrollControl` for taking a place, `my-courses` for the roster and leaving
  one — and the rules those screens keep are §13's.

## 13. Frontend

- **The signed-in portal is a viewport-height frame with one scrolling column.** The sidebar
  runs to the left edge of the window and holds still while `main` scrolls, so navigation never
  slides away under a teacher mid-list. The height is `dvh`, not `screen`: a mobile browser's
  URL bar is part of the viewport, and a frame measured against the screen loses its last row
  of pixels to a bar that is not in the layout.
- **A public portal scrolls as a document.** The student portal is a header, a centered column
  and a page that moves — no held-still sidebar, because the frame above is for somebody who
  sits in a tool for hours and this is a shelf somebody walks past. The tokens are the same
  ones; the difference is only chrome.
- **A call says whether it is asking as somebody.** `apps/student/lib/api.ts` is the teacher's
  transport with one addition rather than a copy: every request carries a `withSession` flag, and
  only the flagged ones attach the bearer, send cookies and revive a dead access token. The shelf
  and the level chips are deliberately unflagged, because sending a cookie there would be the one
  way for a cached catalog response to carry one visitor's session to the next; the outline, a
  page and the roster are flagged, because the API's answer for those depends on who is asking.
  The token itself stays in a module variable, so no render ever reads it out of a component tree.
- **A session is the student portal's own, and it is small.** `SessionProvider` holds the profile
  and nothing else, `RequireSession` wraps the routes that cannot be shown without one, and the
  header account is a link when signed out, a name and a sign-out when in, and a skeleton while it
  decides — three states, and no moment where the screen claims to know. The refresh cookie is
  `HttpOnly` and scoped to `/api/v1/auth`, so nothing outside the API can read it and the gating
  that would otherwise live in middleware lives in the client instead.
- **A door appears only where the answer says there is one.** The outline links a lesson title
  only on a row sent back with `isReadable`, and badges `isFreePreview` as the teacher's own word
  about the page rather than a description of how this reader got in. The page behind a link is
  its own request rather than text carried in the list. Nothing is inferred — not position, not
  colour, not the fact that the course is published — and the screen's refusal keeps the API's
  wording, because a page that explained why it would not open is a list of what to enroll for.
- **A place is asked for, never guessed from the door.** `EnrollControl` reads the reader's
  roster (`GET /enrollments`) and offers the button only for a course missing from it; a course
  present becomes "In this course since …" and a link to the shelf. `isReadable` says what a
  reader may open, which is not the same question — inferring a place from an open page would
  report every free lesson as an enrollment. When the roster read itself fails the button stays,
  because the write is idempotent and the worst a pressed button can do is return the place that
  already exists. The id sent is the loaded `course.id`, never the path segment: an address may
  carry a slug, and a slug is a second valid-looking name for the same thing.
- **Leaving is one press, and the row goes when the server says it went.** No confirmation for a
  decision the student can take again on the next screen — the same reasoning as a teacher's
  Archive — and the local list drops the row only after the cancel returns, so a refused leave
  cannot leave a shelf claiming a place the API still counts as open.
- **A day is shown in the reader's own zone, formatted in exactly one file.** `lib/dates.ts` holds
  the portal's only `Intl.DateTimeFormat`: an `enrolledAt` instant rendered as the day it landed in
  the signed-in user's IANA zone, falling back to the browser's when the profile has none or the
  stored name no longer validates. A relative "2 days ago" beside an absolute date would put two
  calendars on one shelf.
- **A session change re-reads what the session decided.** The outline keys its request on the
  course, a retry counter and the session's state, so signing in re-fetches the same address and
  the locked rows become links without a reload; keyed on the address alone, the screen would go
  on showing a stranger's outline to a student who has just taken a place in it.
- **A settled read is written through the functional updater.** The roster arrives in a
  microtask and the component keeps `{key, roster}` as one value, so the write is
  `setSettled(current => current?.key === key ? current : {key, roster})` — one expression that
  discards a reply from a reader who has since changed, retries a failed read, and forces the
  render that shows the answer. An `alive` flag or a separate retry boolean would be a second
  source of truth for a fact already in the key.
- **Loading is derived from the answer's key, not announced by a flag.** A screen keeps the
  request it is waiting on (`level|search|page`) beside the reply that earned it and shows a
  skeleton while they disagree. Setting a `loading` boolean in an effect would flash a false
  "nothing here yet" every time a filter changed mid-flight, and a late reply from a search
  the visitor has already rewritten would land on top of the current one.
- **The teacher's box says which of the two decisions it made.** `Checkbox` in `@lms/ui` is a
  native input with `accent-color` pointed at the brand token rather than a drawn square, so the
  tick, the keyboard and the platform's own spacing come free. The lesson row then words the
  mark in two tenses — "Free to read" when the page is published, "Free when published" when it
  is still a draft — because a teacher who ticked one box made only one of the two decisions the
  API needs, and a row that said "Free" over a draft would be a promise about a stranger's
  reading nobody made. The flag travels with every save rather than only when it changes: a box
  the teacher cleared has to arrive as `false`, since leaving it out is how an open page stays
  open by accident.
- **One query, one request.** The shelf's search box waits 250ms after typing stops; the level
  chips are a toggle rather than a set, because a course has one level and pressing the chip
  you chose means "that was enough". Both filters clear the page they were applied to.
- **Tokens before components.** `@lms/ui/src/styles/tokens.css` is the only place a colour,
  radius, shadow, duration or type step is defined. A portal re-themes by overriding tokens;
  it does not get to invent `#3b82f6`.
- **Icons are one stroke family, and they answer to the pointer on their card rather than to
  the pointer on themselves.** `Icon` in `@lms/ui` draws every glyph on a 20×20 box in
  `currentColor`; a portal names the mark it wants and the kit owns the geometry and the
  gesture (`styles/motion.css`) in the same place, so the same padlock lifts the same distance
  in all three portals. A mark that reacts alone promises a target that is not there, so a
  hover is opted in by its host — a link, a button, a card or row carrying `data-icon-zone` —
  and reduced motion keeps the colour change while dropping the travel. A glyph gets words
  only when it says something the text does not: a lock in a lesson row that names no state is
  labelled "Behind enrollment", a clock beside "12 min" is not labelled at all, and a page with
  no estimate gets no clock rather than a glyph that claims one.
- Every operation has five states in the primitives, not in each page: idle, loading
  (`Button loading` keeps its label and blocks re-clicks), empty (`EmptyState`), error
  (`ErrorState` with a retry that can itself be busy), settled.
- **Toasts go through `notify()`**, which wraps `react-hot-toast` for timing and renders our
  own card. No page calls a toast library directly, so a notification looks the same in all
  three portals and the library can be swapped in one file.
- **A portal paints what the API confirmed, never what it hoped.** A refused publish leaves
  the row reading `Draft` and the message goes to a toast; a saved edit re-syncs every field
  from the response. An optimistic repaint is a lie the moment the server disagrees, and the
  teacher has no way to tell.
- **`'use client'` is a runtime wall, not a type error.** A server page that calls a
  function exported from a client module compiles clean and fails when the route is opened.
  That is why `buttonClass` lives in `lib/button.ts` with no directive: a `<Link>` styled
  like the action beside it is decided on the server.
- **Motion is CSS.** Route changes use the View Transitions API via React's
  `<ViewTransition>` (`RouteTransition`), links declare `nav-forward` / `nav-back`, and the
  portal chrome is anchored so only content moves. `prefers-reduced-motion` downgrades
  slides to crossfades in one block — with the single exception of the spinner, because a
  frozen spinner reads as a hung app.
- **`will-change` is not a permanent style.** `[data-reveal]` animates once on mount, so
  promoting it to its own layer for the life of the page left every revealed heading rendered
  at composite-plane rasterisation and then never demoted — crisper on the first frame than
  on every frame after. Hints belong on the animation, not the element.
- `@lms/ui` ships TypeScript source with no build step; apps compile it via
  `transpilePackages`. This keeps HMR honest and removes a publish-before-it-works class of
  bug.
- **Storybook is the design system's source of truth for people.** The package has no build
  output to read, so `bun run dev:ui` is how a developer sees a primitive before using it.
  A component without a story is undocumented by definition.
- **One typeface, deliberately.** Inter Variable covers headings, UI and metrics. A second
  family would be a taste decision, and taste does not survive three portals and two
  maintainers. Hierarchy comes from size, weight and colour instead.
- **The Inter build must carry the `opsz` axis.** `base.css` sets `font-optical-sizing: auto`,
  and `@fontsource-variable/inter/wght.css` ships a weight-only face — the declaration was
  present, the axis answering it was not, so every size rendered with one set of metrics:
  too open at 12px for a dense table, too tight at display size for a heading. The import is
  `opsz.css`, and `tokens.test.ts` fails if the kit's fontsource import ever names a build
  without the axis again.
- **Text tokens are contrast-tested, not eyeballed.** `src/styles/tokens.test.ts` parses the
  hex values out of `tokens.css` and re-derives WCAG ratios for every ink and accent against
  both surfaces it can sit on, at the small-text floor of 4.5:1 — a ramp's lightest step is
  used for hints and timestamps at 12–13px, where a decorative gray is a legibility failure.
  `--color-paper-sunk` is exempt because it only appears behind disabled fields and code
  wells. Darkening a token is cheap; a test is what stops it drifting back.
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
- **Route protection is a client gate, not Next middleware.** The refresh cookie is scoped to
  `Path=/api/v1/auth`, so middleware running on a page path cannot see it and any decision it
  made would be a guess. `RequireSession` runs where the answer actually exists, and it sits
  in `app/(portal)/layout.tsx` so a new screen cannot be added unprotected by accident.
- **A `?next=` is only followed after it is proved to be in-app.** `safeRedirectTarget`
  accepts a root-relative path and drops everything else, including `//host` and `/\host`,
  which are how a sign-in form becomes a phishing relay.
- **Forms show what the API named, and nothing else.** `fieldErrors()` puts each message under
  the field it keys, so the rules stay on the server; a failure no field owns — a wrong
  password pair — appears once, as a form-level line, and never says which half was wrong.

## 14. Development environment

- Dev hostnames are `*.localtest.me` (resolves to `127.0.0.1`), so `teacher:3000`,
  `student:3001`, `ops:…` and `api:4000` share one registrable domain and therefore one
  `Domain=localtest.me` session cookie. This is the reason auth will work across portals in
  development exactly the way it will in production, with no CORS or localhost hacks.
- **One browser profile holds one session, because that is what one cookie slot means.** The
  shared cookie is what makes a teacher's login readable to the student portal too, and the same
  mechanism means a second sign-in in the same profile replaces the first — visibly, on reload:
  the tab that signed in later keeps the slot, while a stale access token goes on working in the
  other portal's memory until something needs the cookie. Verifying two roles at once is two
  profiles (or one normal plus one private window), not two tabs, and a screen that shows the
  wrong name after a reload is that fact rather than a bug in the portal.
- Two databases: `lms` for development, `lms_test` for tests, owned by a least-privilege
  `lms` role with `CREATEDB` (Prisma needs it for migration shadow databases). The test
  global setup **refuses to run** unless `DATABASE_URL` names `lms_test`, and redacts
  credentials in the error, because the cost of pointing a suite at the dev database is a
  Saturday morning.

## 15. Verification

`bun run verify` is the gate: shared build → typecheck → lint → tests, across every package.

Tests are written first and are expected to fail before implementation exists. The API
suite boots the real `AppModule` through supertest, so guards, filters, prefix, CORS and
validation are exercised as shipped rather than as mocked; data isolation is a transaction
rolled back per test. Migrations are applied to `lms_test` automatically, and the Prisma CLI
is only spawned when a migration is genuinely missing.

A phase is not "done" when the code compiles. It is done when the tests pass, the browser
behaviour has been checked by hand, and the next phase has been approved.
