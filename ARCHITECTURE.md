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
- Append-only ledgers (payments, moderation decisions, status transitions, the Phase 7 action
  log) never update in place; a correction is a new row pointing at the old one.
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
- **The course price pair is resolved in the service, not by a database constraint.** A bare
  `minorUnits`/`currency` in the write body is caught by the validation pipe (both required
  once `price` is present, amount a non-negative integer), and an unknown or inactive currency
  code is refused with a `price` field error after the service looks the code up under the
  `Currency` lookup — a foreign key alone would accept any well-formed `LkpValue`, including a
  `CourseLevel`. The read side keeps `null` and `0` apart on purpose: `null` is "nobody quoted
  this" and `0` is "this is free", and collapsing them at the shelf would either start a money
  conversation the teacher never joined or print a `₹0.00` that reads as a typo.
- **A teacher's working zone belongs to the account, not to the profile row.** It decides
  when a class is, what "today" means in a dashboard and when a reminder is humane; a copy on
  the profile would be a second truth to keep in step, so the profile form writes
  `users.timezone` and reads it back from there.

## 6. Third-party providers

Video, storage, payments and email sit behind ports in `apps/api/src/providers`, selected
by environment (`STORAGE_PROVIDER`, `PAYMENT_PROVIDER`, `VIDEO_PROVIDER`, `SMTP_URL`).
Domain code depends on the port, never on a vendor SDK.

`PAYMENT_PROVIDER` defaults to `none`: that integration is **not built yet** (Phase 9). The
ports exist so that choosing a vendor later is an adapter plus an env change, not a refactor —
and so nothing pretends to take a payment in the meantime. `STORAGE_PROVIDER=s3` throws at boot
rather than silently doing nothing.

Storage is the first of these to be real (Phase 5, step 5a). `apps/api/src/providers/storage`
defines two operations — write a stream under a key, read a stream back for a key — and the
`local` adapter is the only implementation. Three things follow from that shape, and they are
the parts a caller cannot see from the signature:

- **The caller mints the key.** The endpoint asks for a uuid and appends the extension it
  recognised, because a filename is not unique across teachers and a lesson id is guessable.
  An adapter refuses a key that is absolute, escaping or built from characters the store does
  not name things with, so no path ever leaves the directory it was given.
- **A stored file has no URL.** There is no `STORAGE_PUBLIC_URL` to configure and no public
  directory to serve, because a link that works without a session would be a second door around
  the read gates in §10 and §11. Every byte is streamed by a route that resolved the row, and
  therefore the person, first.
- **There is no delete.** `put` also refuses to overwrite a key that already holds bytes, and a
  retired asset keeps its file, for the reason §2 gives for every other row: the bytes are the
  record of what the teacher uploaded. When a purge is eventually designed it will be a policy
  with a retention rule, not a method sitting here waiting to be called.

`lesson_asset` (§10) is the row that names those bytes, and it is the only thing that does: a
file on the disk belongs to a lesson because a row says so, which is what keeps a listing of
the directory from being a list of what is watchable.

The first route to use it is a teacher attaching a recording to a page of their own (step 5b),
and the order it works in is the reason the port takes a stream rather than a buffer: the page is
proved to belong to the caller, then the bytes stream into `put`, then the row is filed. Nothing
in that sequence can be rearranged — a middleware that parsed the body on the way in would let
anyone with a token spend disk on a lesson they cannot see, and a write that reported success
after being cut short would file a row pointing at half a recording. So the size cap fails the
write instead of truncating it (which is also why it is not multer's own `fileSize` limit), the
local adapter erases a write that never finished, and `displayName` is stored as the text it is
while the key is minted here from the lesson's id and a uuid.

Step 5e is the other direction, and it is where `open` grew a window. A `<video>` element does not
download a recording, it seeks — the head of the file to find its metadata, then whatever range is
under the scrubber — so the window is decided in `common/http/byte-range.ts` against the length the
`LessonAsset` row already carries, never against a `stat` of the file: bytes behind a key are
written once, and the row is the record of how long they were. A header the server cannot make
sense of is ignored and the whole file goes out; a well-formed one beginning past the end is a real
question answered `416` with the real length, which is how a player learns it has outgrown the
recording. Both audiences share one writer of those answers, `streamLessonVideo`, so the teacher's
own page and a student's gated page cannot drift into two range contracts — and each of them opens
the file *before* the first header leaves, so a refusal is still the JSON envelope rather than a
`200` that goes quiet halfway. `apps/api/test/lesson-asset-stream.spec.ts` holds the teacher's
side of that contract and `apps/api/test/lesson-video-stream.spec.ts` the student's, including the
case a player creates on its own: a tab closed mid-seek, after which the next request has to work.

Video is the second port to be real (step 5c). `apps/api/src/providers/video` answers exactly
one question — _where would a class named this be held_ — and its `jitsi` adapter builds
`https://<JITSI_DOMAIN>/<name>` without asking the bridge anything, because a Jitsi room exists
the moment someone types its name. That absence of a handshake is what the no-JWT choice bought
(no vendor account, no key to rotate, no SDK), and the port's shape is the three consequences of
paying for it:

- **The room name is the only secret.** On a public bridge, knowing the name is being invited, so
  the name is minted by the caller from a uuid — never from a course title, a date or a lesson id,
  every one of which someone could work out. The adapter refuses a name that carries a path, a
  query, a fragment or whitespace, and refuses a `JITSI_DOMAIN` that is not a bare host at the
  moment the port is built, so a configuration that would send a class somewhere unintended stops
  the boot rather than surprising a teacher mid-class.
- **An address is not a permission.** Nothing in this port decides whether the caller may join,
  and no route gets to ask it for a URL it has not earned: the gate is the booking endpoint that
  owns the class (§14). A portal that went to the port directly would be a door with nobody
  standing in it — which is also why a room URL is a secret with a URL's shape and never belongs
  in a log line or on a public course page. The first caller asks for a _name_ at the moment a
  teacher confirms, and keeps the answer in a column rather than a response (§14); the address is
  what the join endpoint turns that name into, for one person who has just been checked.
- **`none` is an adapter, not an `if`.** `NoVideo` answers `null`, so the one question a caller
  can ask has one shape on every deployment, and no screen can forget a branch and offer a Join
  button for a room that never was. `none` remains the shipped default for a config that has not
  decided yet; a `JITSI_DOMAIN` the operator did not name is `meet.jit.si`.

It is synchronous on purpose. A port whose only provider needs no network call would be theatre
wrapped in a `Promise`, and the provider that does need one — signed URLs, a JWT to mint them —
changes the shape of the answer, not merely its asynchrony. That is a phase-5-and-later decision,
not a reason to write the signature twice now.

Email is the second of these to be real (Phase 6, step 6a). `apps/api/src/providers/mail` answers
one question — hand this finished message to a transport — and `SMTP_URL` rather than a
`MAIL_PROVIDER` string is the switch, because there is one kind of mail transport to name: a box
either points at an endpoint or has not decided yet. Four things follow from that shape.

- **nodemailer appears in one file.** The adapter declares the two words of a transport it uses
  (`sendMail` with a from, a to, a subject and two bodies) and takes one as a constructor argument,
  so the specs send through a double and a caller never sees `SentMessageInfo`. §6's reason for
  ports is exactly this: a route that can name a vendor's type is a route that cannot change vendor
  without an edit.
- **`none` is an adapter here too, and it says what it is.** `NoMail` resolves instead of throwing
  — a notification is not the reason a request happened, and a school with no mail should still be
  able to book a class — while `delivers` on the port tells the truth about it. The outbox (§6,
  step 6c) asks before it records anything, because a dropped message marked as sent is the one
  claim nobody can check afterwards.
- **It is async because it waits on somebody else's server.** Which is why `send` belongs to the
  delivery sweep rather than to the request that made the news: a mail host being unreachable
  cannot slow a booking down, and cannot lose it either, because the decision to notify is written
  in the same transaction as the change it reports.
- **A mail is a leak risk, so the port refuses three things.** A line break in a recipient or a
  subject would write more headers than this platform intends, and a comma in a recipient turns one
  address into a list, so both are refused before the transport is reached — bodies may span lines,
  headers may not. `failureReason` is the transport's error code (`EAUTH`, `smtp 550`) and never its
  message, because nodemailer puts the host, the port and on an auth failure the login it was given
  into that text. A log line may name the event, never the recipient: an address in a log is a copy
  of personal data in a file that gets rotated, shipped and grepped. And no mail carries a room
  address, a stored key or a token (§10, §14, §7) — a message sits in a provider's storage and on
  whichever device reads it, none of which this platform controls, so links point at a portal page
  that then asks who is calling.

An unusable mail config stops the boot rather than the send: `SMTP_URL` without `MAIL_FROM` is
refused instead of letting the vendor answer with the login's own address in the `From` header, and
a URL that is not `smtp://` or `smtps://` is refused where the port is built, naming the key.

### Rendering a message (Phase 6, step 6b)

The port takes a finished message, so something has to finish it. That something is
`apps/api/src/modules/notifications`: `email-primitives.tsx` owns the document and
`render-email.tsx` fills one `email_template` row's copy into it, in both shapes, from one call.

- **Layout in code, copy in the database.** A row holds a subject, a heading, a list of sentences
  and an optional button label — the words an operator rewords. It does not hold HTML: a document in
  a row is markup nobody reviewed, and Outlook renders it with Word's engine, which ignores flexbox,
  grid and padding on an anchor, while Gmail clips a `<style>` block it does not recognise. So the
  primitives are tables with `role="presentation"`, a width written as an attribute *and* a style,
  inline styles only, a button built from a table cell, and no image at all — an SVG renders badly
  and a hosted PNG needs a public URL, which §6 refuses for gated bytes and which would tell whoever
  served the file that this particular person read this particular message.
- **React, server-rendered inside the API.** §15 keeps React in the portals, and the API is the only
  writer, so there is no server boundary to render in and React Server Components is not the
  mechanism; `@react-email/*` is ESM-only and this package is `"type": "commonjs"`, so it cannot be
  required here. `renderToStaticMarkup` is a synchronous call in a plain module, and the specs plus a
  `nest build` → `require()` pass are the evidence the primitives were adopted on rather than the
  assumption they would work. The cost is recorded where it is paid: `apps/api` now compiles `.tsx`,
  which retires the `<Foo>value` assertion form in that package (the house form is `as`), and Inter is
  absent from the font stack for the same reason the portals' stylesheet is — it is self-hosted and
  exists on no reader's machine.
- **One tree, two shapes, written from the same filled strings.** The text body is not the HTML with
  its tags cut out — that loses the address behind a button whose label is a sentence, which is the
  one thing a reader needs in order to act.
- **`{slot}` is the whole contract.** A name, not an expression: no filter, no branch, nothing a row
  could be coaxed into. A slot the payload cannot answer is refused rather than printed, because
  "Your class is on {when}" is a message with the useful part missing and a broken row that would
  keep producing one.
- **The href comes from code, and a refusal does not repeat it.** The caller that owns the thing the
  message is about names the destination; `assertPortalHref` accepts only absolute http(s). The
  thrown message deliberately leaves the value out — an href is where a room address would arrive if
  a caller ever passed one by mistake, and this error outlives the request in a log line (§10).

`email_template.event_code` is unique across every row rather than across the standing ones, the
identity half of the split §2 uses elsewhere: a code names a send decision in the code, and two rows
answering to one would leave a caller unable to say which a reader got. A reword is an update in
place; what a message once said is Phase 7's action log to hold.

### Queueing the news (Phase 6, step 6c)

`mail_outbox` is where a send decision is written down, and it holds the news rather than the
letter: an event code, the payload that answers the copy's `{slot}` names, and the account to tell.
Four choices follow from that one.

- **Rendered at delivery, not at the request.** A retry can only succeed if the letter is assembled
  again, so a reworded template or a payload that was missing a sentence repairs a queued row
  instead of leaving it wrong forever. The other half of the reason is the harder one: the write
  inside a booking's transaction is one insert of facts nobody can get wrong, and no notification
  can fail a class.
- **`event_code` is a string, not a foreign key into `email_template`.** An FK would make a missing
  template row an error in the transaction that recorded a place in a course. An event with no copy
  is instead a row the sweep refuses to render: it becomes `failed` with the reason the renderer
  gave, and the class still happened.
- **No column can hold an address.** `recipient_user_id` is the reference and `User.email` is read
  when the sweep sends, so a person who fixed a typo is not mailed at the old one, and the queue
  never carries a copy of personal data that outlives the correction or the deletion. This is the
  same rule §7 states for a JWT and §6 for a log line, applied to a table: the schema test asserts
  the exact column set, so a `recipient_email` column cannot arrive by drift.
- **The status vocabulary is a list in `@lms/shared`, not a lookup type.** `Lkp*` exists so Ops can
  add a value without a migration, and nobody can add an outbox state without writing the sweep code
  that would honour it; a state whose only writer is a scheduler is a step in a program. The five
  names are `queued`, `sending`, `sent`, `failed`, `dropped` — and `dropped` is kept apart from
  `sent` because 6a's port promised a box with no mail would never record a throwaway as a
  delivery.

`nextAttemptAt` is not nullable, because `null` would have to mean both "never scheduled" and
"never again": a finished row keeps the last time it was due as a fact and `status` is what says it
is over. `sentAt` is its own column rather than a read of `updatedAt`, because a retry touching the
row would otherwise move the date a person asks about. `failureReason` holds the transport's code,
which 6a's adapter guarantees is short and sterile — a CHECK on its shape would be a second, weaker
copy of that guarantee in the wrong place. And nothing is unique here: the same news legitimately
happens twice to one reader, and a queue with a unique key is a ledger that refuses to say anything.

### Filing the news where it happens (Phase 6, step 6d)

Seven writes now say what they decided: a student asking for a minute, a teacher confirming or
refusing it, a request left to expire, a student giving a class back, and a place in a course taken
or left. Each files exactly one `mail_outbox` row, and it files it *inside the transaction that
moved the row* — the outbox rule, which is worth more than the pattern's usual justification. A
letter queued after a commit is a letter about a class that a rollback may never have allowed.

- **The repository calls the queue; the service names the event.** Each write takes a `notify`
  callback that receives the caller's `Prisma.TransactionClient` and the row as its own statement
  just read it. `when` the news is filed is a fact about the transaction, and only the transaction
  knows it; `which` event a write is belongs to the service, which owns the vocabulary. Passing a
  queue dependency into the repository and letting it guess the event would put a second copy of
  "what just happened" in the wrong file.
- **A replay files nothing.** This is the whole reason the callback is a parameter rather than a
  line after the write. The second press of a book button, the second press of a confirm, the loser
  of a race, a refused conflict, a `404` gate and a leave on a place that is already closed all
  reach no notifier, because none of them made news. Reopening a place a student left *is* news on
  an old row: they really are back in the course. A person told twice about one decision stops
  believing the queue, and the queue is the only thing that will tell them about the next one.
- **The expiry sweep moves row by row.** A bulk update reports a count, and a count cannot be
  addressed — an expiration letter has to reach the student who asked for *that* minute, so the
  sweep asks for each row's own after-image inside the transaction that files the news about it.
  What made it safe to run twice is unchanged and is not the callback: the pending status is in
  every `where`, so a second pass matches nothing.
- **A class message is written in its reader's clock and names the other person.** A class instant is
  one row and two different times on two screens, so `when` is formatted from the *recipient's*
  `User.timezone` (§5), never the class's or the sender's. And the copy addresses the reader by
  naming the person they are waiting on: a teacher is told who is asking, a student who answered. A
  place carries no instant at all — taking a place is a decision, not an appointment, and the copy
  asks for the course and the teacher's name.
- **A join is news to the student alone.** Both enrollment events point into the student's own
  portal; a teacher who wants to know who joined reads their roster, which is a page with a count on
  it rather than a letter that has to be sent. The five booking events divide the same way: the ask
  and the cancellation are calendar news for the teacher, and the three answers are news for the
  student.
- **An href is built from an origin the deployment configured.** `TEACHER_PORTAL_URL` and
  `STUDENT_PORTAL_URL` are required absolute URLs, and the path is a string written in this file
  with every segment percent-encoded. The origin is not taken from the request: a notification sent
  by a scheduler has no request, and a link assembled from a `Host` header is a link an attacker
  chooses. The encoding is what makes "the path is ours" true for the part that is interpolated — a
  course id shaped like `../../evil.example` still lands on the portal, and a room address has no
  parameter it could arrive through (§10).

What the queue refuses to hold is inherited rather than restated: no address, no rendered letter,
and no claim that anything was sent. `status`, `attempts` and `next_attempt_at` stay at 6c's column
defaults, so a row written here says only that something happened and somebody should hear about it.
Whether it hears is 6e's sweep.

The choice has now been made, which is why these are phases rather than open questions:

- **Video is Jitsi** (`VIDEO_PROVIDER=jitsi`, Phase 5). A live class is a Jitsi room the API
  names and both portals open in an iframe; the port returns a URL and the meeting identity,
  never a vendor SDK type. The same phase carries a teacher's **uploaded** video through
  `STORAGE_PROVIDER`, which is the second reason storage gets built before either is demoed —
  a recorded lesson and a live room are one field apart on a page, and two completely
  different promises about where the bytes live.
- **Money stays `none` until Phase 9**, and it arrives together with **coupons**: a discount
  code is meaningless on a course nothing charges for. A teacher issues many codes per course
  from the course itself, each carrying its own discount and its own lifetime (an
  `LkpCouponValidityUnit` interval rather than a wall-clock enum, so "48 hours" and "the end
  of the month" are data), and a student redeems one on the way to a place. Because
  redemption is a decision about money, it belongs after every portal exists — a code entered
  in one app and honoured in another is exactly the drift this system keeps to one API.
- **Every entity's writes will be recorded** (Phase 7): an append-only `ActionLog` of who did
  what, to which row, and in which part of the app. It is a phase rather than a column added
  now because a record needs to name the screen an action came from, and several of those
  screens do not exist yet.

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
- **A course can carry a price, and the price is a quote, not a checkout.** `priceMinorUnits`
  and `priceCurrencyValueId` are two nullable columns that move as one decision (§5), the
  currency a `LkpValue` under the `Currency` type rather than an enum so a new one is a seed
  row, not a deploy. `null` in both means nobody has quoted it — which a shelf renders as
  silence, distinct from a `0` that means free. Nothing charges it: `PAYMENT_PROVIDER` is still
  `none` (§6), a place in a course is still taken for free through enrollment (§12), and the
  figure is the teacher's stated intent rather than a settled transaction. It is writable while
  a course is a draft and locked once published, exactly like every other field the student
  reads.
- **`DELETE` is still not a thing.** Retiring is archiving; the row is what an enrollment points
  at (§12), and an archived course keeps a roster of the people who were inside it.
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
  carries draft → published, and a page is readable only when its lesson is published _and_ its
  course is published: neither flag may expose the other's unfinished work. A module deliberately
  has no flag (§9) — it is a heading, and a heading with an opinion of its own would need rules
  for which of the three wins.
- **The content is one markdown `body`, capped at 20 000 characters.** No embedded video, no file
  attachments, no block editor: those are the shapes that need a provider, and a provider is a
  decision for later. That later is now Phase 5 (§6), which adds a lesson's video through the
  storage and Jitsi ports — so the body stays a plain column and a page gains a _second_ thing
  rather than growing an editor that has to parse its own content.
- **That second thing is a row of its own.** `LessonAsset` names the bytes a teacher uploaded and
  the key the storage port keeps them under (§6), and a lesson stands one at a time: attaching a
  replacement retires the previous row rather than deleting it, so the page keeps a history of
  what was taught from it. `displayName` is what the teacher recognises and `storedKey` is the
  store's business, which is why neither is the other — two teachers both uploading `intro.mp4`
  must not collide on bytes. Which row stands, and whether an upload is a video of a sane size,
  are the endpoint's rules; the table's are only that no two rows ever name the same file, and
  that a lesson somebody attached something to cannot be deleted underneath it.
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
/api/v1/catalog/courses`, `/catalog/courses/levels`, `/catalog/courses/:id`,
`/catalog/courses/:id/lessons/:lessonId` and that page's `…/video`, in their own Nest module
(`modules/catalog`) because the question they answer is different in kind: no ownership,
no writes, and — but for the routes below — no session either.

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
- **A card's counts and a card's price come from the same row the detail lists.** A published
  course exposes `price` — `{ minorUnits, currency: { code, label } }` or `null` — on both the
  list item and the outline, with no session involved, because a quote is the same figure to a
  stranger and to a member. The currency travels as a `{ code, label }` pair rather than a bare
  code so the shelf can print a symbol without a lookup of its own, and the two catalog queries
  `include` the price relation for exactly that reason.
- **The outline never hands over a page; one named endpoint does.** `body` is not selected by
  the syllabus query — a student browsing sees titles, order and each page's rough length, which
  is enough to decide. The exception is `GET /catalog/courses/:id/lessons/:lessonId`, which
  returns a body for a page its caller may open: one the teacher marked `isFreePreview`, or any
  published page of a course they hold a place in. It is one route, not a syllabus row with text
  slipped in, so the outline keeps one shape whether or not any room on it happens to be open.
- **A page's recording is that same door, answered in bytes.** `GET
  /catalog/courses/:id/lessons/:lessonId/video` asks the readable-page question above and nothing
  subtler — a locked page, a page of a course nobody published and a page that never was all
  answer the one `404` — and then streams the standing `LessonAsset` with its range honoured (§6).
  It is a route rather than a link on the page because a guessable URL for these bytes would be a
  second door around every gate on this shelf, which is also why no response here carries the
  store's key. The page route answers for it, though: `video` on a readable page is
  `{ displayName, bytes }` or `null`, read off the standing `LessonAsset` row rather than a `stat`
  of the file, because a screen has to be able to say whether a lesson was filmed — and how big it
  is — before it asks for a byte of it.
- **Each outline row carries two flags, because they answer two questions.** `isFreePreview` is
  the teacher's statement about the page — true whether or not anybody is signed in, and worth a
  badge. `isReadable` is about the reader: it says the page route will hand _this_ caller the
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
  place is _worth_ stays the catalog's decision — this module writes the row §11 reads.
- **The role is the whole of "a teacher cannot enroll in their own course."** The student
  controller is `@Roles(STUDENT)`, so that request never reaches a query to be checked. When a
  later phase wants teachers to take places too, the decorator is the one line that changes, and
  the ownership question it would raise is a decision somebody makes on purpose rather than a hole
  a service forgot to plug.
- **A fourth route reads the same table for the teacher who owns the course.** `GET
/api/v1/courses/:courseId/roster` answers the question `ix_enrollment_course_roster` was built
  for, and it is addressed through the course rather than through a student, so ownership is the
  whole permission: another teacher's roster and a uuid nobody wrote are one `404`, exactly as on
  every other `/courses/:id` route, because a `403` here would confirm that the course exists and
  that somebody is inside it. It still lives in `modules/enrollments`, which owns the table — the
  module reads `Course` for the ownership probe for the same reason it already reads it for the
  publish gate on the other side.
- **A roster row is a name and a day.** The entry is `student: { id, fullName }` plus
  `enrolledAt`, and the shape is held by a test rather than left to taste. No email address: a
  teacher does not need one to know who is coming to class, and a field added for convenience is
  a field every later version has to defend. No enrollment id either, because there is no
  teacher-side route that acts on a row — a roster is read, not managed, and the first endpoint
  that needs an id is the decision to add one.
- **It lists the class, not the history.** Only `isActive` places, newest first, paged
  `{ items, page, pageSize, total }` like §11's shelf. A student who left is off the list and out
  of the count, and one who came back is a single entry on the day they first arrived; a draft
  course reads empty for its own teacher rather than refusing, and an archived one still names
  who was inside it, since archiving closes pages rather than rewriting who turned up (§2).
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
  light up and the silence they keep, and `apps/api/test/course-roster.spec.ts` for the teacher's
  read of the same table — who is in the class, who is not, and what a roster is not allowed to
  say. The student portal reads the first set now — `lib/enrollments.ts`
  for the transport, `EnrollControl` for taking a place, `my-courses` for the roster and leaving
  one — the teacher portal reads the roster at `/courses/[id]/roster`, and the rules those screens
  keep are §15's.

## 13. Availability

A teacher's week is four numbers per window — which weekday, when it opens, when it closes, how
long a class is — and nothing in it is expanded into dates. An expansion is a snapshot, and a
teacher edits their week.

- **Wall clock, in the teacher's zone, nowhere near UTC.** `startMinutes` means "half past nine on
  a Tuesday" and the zone it means is that teacher's `User.timezone`. Storing an instant instead
  would ask every window the question §5 answers twice a year, and get it wrong on the day the zone
  changes its mind. The instant only ever exists once a student books a minute out of the window.
- **Three rules make a window a window, and all three live in the service.** It closes after it
  opens; a class fits inside it; no two standing windows cover the same minute. The columns
  deliberately accept anything numeric (`availability-schema.spec.ts` holds that line), because
  each of those is a question about four numbers together or about a set of rows, which is not
  something a field-level check on a DTO can answer. Overlap is reported against `startMinutes` —
  the box the teacher was typing in — and two windows that merely touch, 09:00–10:00 and
  10:00–11:00, are a Tuesday afternoon rather than a collision.
- **Retirement is the only exit, and reopening finds the same row.** `POST :id/retire` closes a
  window; a window later set at that same weekday and opening minute reopens the original row
  instead of adding a second one competing with it, because `@@unique([teacherUserId, weekday,
startMinutes])` is a business key that outlives `isActive` (§2). Two tabs saving the same window
  at the same moment settle on the key, and the loser is told the same thing it would have been told
  by the check it raced past.
- **Four routes, one teacher's own week.** `GET/POST /api/v1/availability/rules`, `PATCH
/api/v1/availability/rules/:id`, `POST /api/v1/availability/rules/:id/retire`, in
  `modules/availability`. Ownership answers `404` — a colleague probing ids learns nothing about
  whose schedule exists — and the list reads only active rows, since a retired window is the
  teacher's history rather than something to offer.
- **What holds it:** `apps/api/test/availability-schema.spec.ts` for what the table promises and
  what it deliberately does not decide, and `apps/api/test/availability.spec.ts` for the routes,
  the three rules, the reopen, and the silence about another teacher's week.
- **A window repeats every week and nothing else, on purpose.** There is no exception list, no
  holiday and no date range, because Phase 4's promise is only that a teacher's week becomes
  minutes they can be asked for. Two things the user asked for later are Phase 10 for that reason:
  a **course's own class series** (a course that keeps meeting on the same weekday and minute,
  rather than being re-booked one slot at a time) and **blocked days** (a teacher marking a
  holiday, so no minute of that date is offered even when the weekday says otherwise). Both are
  edits to what a window expands into, so both belong after `slotAt` has been exercised by the
  booking loop and by whatever Phase 5 attaches to a booked minute — an expansion is the one
  function in this system where an exception would have to be honoured in three places at once.

## 14. Bookings

A booking is a class a student asked for. It is not a calendar entry, a meeting link or an
invoice: `startsAt` is the minute they chose, `durationMinutes` is the length that minute was
offered at, and everything else about the hour happens somewhere else.

- **The grid is derived, never stored.** `GET /api/v1/bookings/slots?course=` expands the
  teacher's windows across a rolling 30-day horizon (`BOOKING_HORIZON_DAYS`) in their zone and
  subtracts the minutes already held. There is no `slot` table to keep in step with a teacher's
  edit, which is the whole reason a booking reads `AvailabilityModule` and `EnrollmentsModule`
  through their own services rather than reaching for their tables.
- **One function answers "what is on the calendar" and "may this minute be booked."**
  `slotAt` in `packages/shared/src/schedule.ts` is the same expansion the grid came from, so an
  offer and a booking cannot have different answers about the same minute — and a student who
  sends a time that was never on any grid is refused for that reason, not by a length check.
- **A day is a set of instants, so a DST change moves a class rather than mislabelling it.** The
  window is wall clock; the row is UTC. A February class and a March class at the same clock face
  in Kolkata are two hours apart in the table, which is exactly what the student agreed to.
- **What a student is entitled to decides the grid before any window is expanded.** Enrolled in a
  published course: its class times. Not enrolled, the course opts in to trials, and this student
  has never had one: the same times, as a demo. Anything else: nothing. The read answers `200` with
  `entitlement` and `denial` so a portal can render "Enroll to see class times" as a screen, while
  the write answers `409` — a request that cannot exist is a state conflict, not a fact about a
  field.
- **A trial is per course, opted into by its own route.** `POST /api/v1/courses/:id/demo-bookings`
  with `{ enabled: true }` is the course's yes (§8 keeps the route in `modules/course`), and it is a
  route rather than an edit-form field because the form closes when a course publishes and offering
  trials is what a teacher decides about a course already live. One demo ever per (student, course),
  counted over surviving rows — a cancelled, refused or expired trial was still the trial a student
  asked for.
- **A request is not a class until the teacher says so.** Every booking starts `pending`, and the
  minute is held from the moment it is asked for (`slotHeldAt`), because a teacher deciding about
  Thursday should find Thursday still free on Friday. `pending` and `confirmed` are the two statuses
  that block (`BLOCKING_BOOKING_STATUSES`); refused, called off, taught and expired all give the
  minute back.
- **The race is settled by the database.** Writing the hold goes: advisory transaction lock on
  teacher + instant, a check that this student has not already asked for this minute, a check that
  no standing row of this teacher's _overlaps_ the requested length, then the insert — with
  `@@unique([teacherUserId, slotHeldAt])` underneath it all, so two students who both pass the
  checks leave one row and a `P2002` that reads as "that time is gone". Overlap rather than
  equal-start is deliberate: a teacher who shortens a window retiles a week, and a forty-five-minute
  class can otherwise land in the second half of an hour already taken.
- **Both status moves — the student's cancel and the teacher's answer — are one compare-and-swap.**
  The status just read is part of the update's own `where`, so a student cancelling as the teacher
  confirms gets one of the two, and the loser is told to look again rather than being shown a row
  whose status says one thing and whose hold says another. Releasing the hold and writing the status
  are the same statement, always.
- **A confirmed class gets a room, and a list gets only the window it opens in** (step 5d).
  `roomName` is written by the same statement that writes `confirmed` — a uuid through the video
  port, so a `VIDEO_PROVIDER=none` deployment mints nothing and has no branch to forget — and is
  never rewritten afterwards: a second confirm replays the row with its original room, a rebooked
  minute gets a new one, and unique-but-nullable is both halves of the promise (two classes never
  share a room; a hundred waiting requests share nothing). Reads carry `live: {opensAt, closesAt}`
  from `liveClassWindow` on the confirmed rows and `null` everywhere else — a pending request has
  no room yet and a cancelled one has no class — while the address stays server-side, because a
  room's name is its only lock and a list is something a browser keeps, caches and logs. Giving
  the address out is the join endpoint's job, one checked person at a time (§6).
- **The address itself is handed out one person at a time** (step 5e). `POST /bookings/:id/room` is
  the only route that turns a `roomName` into a URL, and it is a `POST` for a read: its response is
  the room's only lock, and a `GET` would be an invitation to a browser's prefetch, a history entry
  and any proxy that keeps responses — so it also leaves with `Cache-Control: no-store`. It carries
  no `@Roles`, because the two accounts it opens for are read off the row rather than claimed by a
  role, and everybody else — a stranger, a classmate holding a place in the same course, another
  teacher — gets the identical 404 an invented id gets. The gates run in that order: are you on it,
  does the class stand, does it have a room, is it *now*. Early answers with the same `opensAt` the
  lists publish, so a portal with a wrong clock still counts down to the minute the server unlocks;
  late answers the same way as having never been let in, with the room left on the row, because a
  class that was taught is not un-taught. Asking twice is the same answer and writes nothing, and a
  `VIDEO_PROVIDER=none` deployment answers `409` rather than `503` — nothing failed, this box just
  has no rooms.
- **Unanswered requests expire on a clock, because nobody is coming to answer them.**
  `booking-request-expiry` runs hourly (`@nestjs/schedule`, the only job registered) and ends rows
  older than `PENDING_REQUEST_HOURS` or whose class minute has arrived, into `expired` with the hold
  cleared. Two clocks because two questions: a day of silence is a teacher's answer in itself, and a
  class whose minute passed without a yes was never going to happen. The `pending` status is in the
  sweep's own `where`, which is what makes a second pass find nothing and two API instances on one
  database harmless.
- **Every door is idempotent, because a button on a slow connection gets pressed twice.** The same
  student asking for the same minute of the same course replays their existing row instead of
  adding one; cancelling a cancelled class and confirming a confirmed one both answer `200` with
  the row as it now reads.
- **Four student routes, four teacher ones and one they share, on one table.** `GET slots`,
  `POST /bookings`, `GET /bookings` and `POST /bookings/:id/cancel` for the student;
  `GET /bookings/requests`, `GET /bookings/classes`, `POST /bookings/:id/confirm` and
  `POST /bookings/:id/reject` for the teacher — both teacher lists read from the teacher rather
  than the course, because a teacher with
  four courses keeps one list of people wanting Thursday. Each list returns every active row
  soonest-first and lets the screen decide what "upcoming" means; `requests` is pending-only,
  because answered ones are not a queue, and `classes` keeps them all, because an answered Tuesday
  is still a Tuesday. Both carry the student's name, which the student's own list does not: a
  teacher's six o'clock is somebody's lesson. The fifth, `POST /bookings/:id/room`, belongs to
  neither door and is the reason the roles are asserted per-route in this module instead of on the
  controller.
- **What holds it:** `apps/api/test/booking-schema.spec.ts` for the table,
  `booking-slots.spec.ts` for the grid and the entitlement that picks it, `booking-create.spec.ts`
  for the hold and the race, `booking-cancel.spec.ts`, `booking-answer.spec.ts` and
  `booking-expiry.spec.ts` for the three ways a request stops being one, `booking-classes.spec.ts`
  for the teacher's own calendar, `booking-room.spec.ts` for the room a confirmation brings and the
  window that list carries, `booking-join.spec.ts` for the door that turns the window into an
  address, and `packages/shared/src/schedule.test.ts` for the expansion all
  of them agree on.

## 15. Frontend

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
- **The teacher's roster screen reads, and does not manage.** `/courses/[id]/roster` in the
  teacher portal counts the class from `total` rather than from the rows on the page, and turning
  to page two asks the API for it instead of slicing what already arrived — a course with ninety
  places does not have ninety of them in the browser. The course title and its status pill travel
  above the list because an empty roster on a draft and an empty roster on a published course are
  two different news, and the screen offers no way to remove anybody: §12 never grew a route for
  it, so a button would be a promise the portal could not keep.
- **A day is shown in the reader's own zone, formatted in exactly one file.** `lib/dates.ts` holds
  the portal's only `Intl.DateTimeFormat`: an `enrolledAt` instant rendered as the day it landed in
  the signed-in user's IANA zone, falling back to the browser's when the profile has none or the
  stored name no longer validates. A relative "2 days ago" beside an absolute date would put two
  calendars on one shelf.
- **A week is drawn once, and a portal decides what a chip means.** `Calendar` in `@lms/ui` is
  given a tone and an optional handler per cell: a chip with no handler is a static `<span>`, so
  the minutes a student cannot take never enter the tab order. Which of this student's bookings
  sits on which of the teacher's open minutes is decided in `apps/student/lib/slot-week.ts`, not
  in the screen, and a held minute wins the cell over the open slot it covers — the grid the
  teacher keeps and the grid this student is looking at are the same week read twice.
- **A class is read in the clock of whoever is looking at it.** The booking screen captions its
  grid as the teacher's zone, because the window is theirs, and the student's own `/my-classes`
  prints every row in the student's, because the class is something this person has to be awake
  for. Both lists split Coming up / Earlier on the start date alone: on status alone a confirmed
  class keeps claiming to be upcoming after its hour has passed, and on whether the minute is
  still held a called-off class vanishes from the week it happened in.
- **A door shows only when the list says there is one to open.** A class row renders its `live`
  window as words rather than as a button before the window and a refusal after it, and the
  screen's clock re-reads itself on an interval so a person who opened the page at 08:00 finds
  Join waiting at 09:25 without a reload. Pressing it asks the room route for the address and puts
  that answer in an `<iframe>` with `referrerPolicy="no-referrer"`, never in a link: a `<video>`-
  shaped `<a>` would leave the room's only lock in the history, the status line and the referrer
  header of the site it just opened, and a browser prefetches some of those on hover. Leaving takes
  the frame back out of the document. Both portals draw it from the one rule their list already
  carries, and the student's two leaving buttons stay worded apart: **Leave the room** closes the
  frame, **Leave this class** cancels the booking, and a screen that gave both the same words would
  let one press read as the other. On a `VIDEO_PROVIDER=none` deployment every row arrives with
  `live: null` and no screen in either portal mentions a room, which is the same answer §6 gives
  and the reason the branch is a missing prop rather than a disabled button.
- **A recording is fetched, not pointed at.** The portal's transport has three shapes over one
  refresh-and-replay loop — `apiJson` for an object, `apiForm` for a file, `apiBytes` for bytes
  back — because a `<video src>` cannot carry the bearer token that authorizes the bytes behind it,
  and adding a cookie surface to the video route to make a `src` work would be a second way into the
  same file. So the player is handed `URL.createObjectURL(blob)` and every lease on it is closed:
  hiding, replacing and unmounting all revoke, and a second Play re-reads. Replace is one upload
  rather than a delete and an upload, because the API's retire-and-file is one decision and a
  half-way failure would leave a page with no recording at all. A refusal about the file lands as
  field-keyed text under the control that caused it while the standing row keeps its name and size;
  any other refusal is a toast, because the file was fine. The student's player is the same fetch
  with one thing decided earlier: the response that carried the page's text also named its file and
  said how long it is, so the screen prints the name and `2.0 MB` and offers Play without asking a
  second question of the API — a student on a phone connection does not download a lesson to find
  out whether the lesson was filmed, and a page with no recording draws no player at all.
- **A session change re-reads what the session decided.** The outline and a lesson page each key
  their request on the reader as much as on the address — the outline on the course, a retry counter
  and the session's state, the page on its course and lesson likewise — because the catalog answers
  the same URL differently depending on who sends it, and the browser sends the cookie whether or
  not the portal has worked that out yet. So signing in re-fetches the same address and the locked
  rows become links without a reload, and a page that 404'd for a stranger paints for the student
  who holds a place in it. Keyed on the address alone, both screens would go on showing a
  stranger's answer to somebody who has just become a member.
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
- **A price is entered in the major unit and sent in the minor one.** The editor's Price box
  takes `499`, the currency picker offers only the `Currency` lookup's active rows (plus a real
  "No price" option, because clearing is a choice a `disabled` placeholder cannot be), and the
  form converts with `toMinorUnits` before the request — the same helper the display side reads
  back through `fromMinorUnits`. The two boxes are one decision: a half-filled pair is refused
  in the browser with the complaint on the empty box, so a round trip never happens on a price
  the API would reject anyway. On the shelf and the outline, `apps/student/lib/price.ts` is the
  single place that turns a `CoursePrice` into words — figure, `Free`, or nothing — and the card
  and the header call it rather than each deciding whether `null` means "say zero" or "say
  nothing". The figure is `formatMoney`, so grouping follows the currency (lakh groups for a
  rupee) rather than the reader's locale, and a price on the page stays a quote: the enroll
  button is unchanged, because taking a place is still free.
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

## 16. Development environment

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
- **In development a role can also be shadowed by its own earlier login, not just followed by
  one.** Before `COOKIE_DOMAIN` was set, the API wrote a host-only refresh cookie for
  `api.localtest.me`; the browser sends that one first and `readRefreshToken` takes the first
  match, so a session revive can land on an account that was signed out of sight and a reload
  brings it back. Signing out revokes the shadowed session and clears it. The artifact lives in the
  local cookie jar, not in the code path — a deployment that always had `COOKIE_DOMAIN` set never
  writes the host-only twin.
- Two databases: `lms` for development, `lms_test` for tests, owned by a least-privilege
  `lms` role with `CREATEDB` (Prisma needs it for migration shadow databases). The test
  global setup **refuses to run** unless `DATABASE_URL` names `lms_test`, and redacts
  credentials in the error, because the cost of pointing a suite at the dev database is a
  Saturday morning.

## 17. Verification

`bun run verify` is the gate: shared build → typecheck → lint → tests, across every package.

Tests are written first and are expected to fail before implementation exists. The API
suite boots the real `AppModule` through supertest, so guards, filters, prefix, CORS and
validation are exercised as shipped rather than as mocked; data isolation is a transaction
rolled back per test. Migrations are applied to `lms_test` automatically, and the Prisma CLI
is only spawned when a migration is genuinely missing.

**The packages test one at a time, and a suite still does not get to ask for every core.**
`bun run test` runs each package's own suite in order and stops at the first failure, because five
vitest processes sharing one box stopped being a gate: the teacher's 245 tests finish in 75 seconds
alone and were timing single `userEvent` waits past fifteen seconds inside the parallel run, with a
different set of files failing every time — which is a gate measuring the machine, not the code.
Ordering is the cheapest cap there is, so the per-suite caps stay as well: the API holds at four
forks (§16's Prisma pool), the UI kit and both portals at two threads each, and a component test
waits fifteen seconds rather than vitest's five. The numbers were set by running the gate until it
stopped being wrong, not by a theory about core counts.

A phase is not "done" when the code compiles. It is done when the tests pass, the browser
behaviour has been checked by hand, and the next phase has been approved.
