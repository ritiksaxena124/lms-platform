# How the system fits together

One API, four front ends, one database, one component library. That is the whole inventory, and the
reason it stays that small is that every interesting decision here is about a teacher's minutes —
not about running a distributed system.

This page walks the shape of it. The reasoning behind each part lives in `ARCHITECTURE.md` in the
repository, section by section, and is numbered so that a line of code can cite the argument that
produced it.

## What one request does

A portal sends REST to `/api/v1`, and the request passes through the same five hands every time:

1. **Middleware** puts a request id on it, which ends up in the log line, in the `x-request-id`
   response header, and in any error body — so a report that quotes one identifier is enough to find
   the event.
2. **The guards** decide who may ask. A bearer access token is checked, then the roles the route
   names. Some routes are marked public; one class of route reads a session if one is offered and
   asks for nothing if it is not, which is how the catalog can say _this page is yours_ to somebody
   who is already enrolled without requiring a login.
3. **The controller** holds the shape of the request and nothing else.
4. **The service** holds the rules — what may change into what, who owns the row, whether the course
   is live enough for this to be allowed.
5. **The repository** is the only thing that speaks Prisma.

A refusal comes back as one envelope everywhere: a status code, a machine code from a closed list, a
sentence for a person, the request id and the time. [Rules the code enforces](/docs/conventions)
states those constraints and says which test checks each.

## Modules, not layers

`apps/api/src/modules` holds one folder per domain — accounts, action log, auth, availability,
bookings, the catalog, courses, enrollments, notifications, the teacher's profile. Each owns its
controller, service and repository, and no module imports another module's internals. The seams are
drawn in code where they cost nothing and stay unused until a measured need appears.

The API is the only writer. Nothing else touches the database — not a portal, not a script, not a
cron with its own connection — which is what makes a rule stated in a service trustworthy.

## Ports, not vendors

Three folders in `apps/api/src/providers` are the entire surface this platform offers to hand to
somebody else's system: `mail`, `storage` and `video`. Each defines the operations the domain needs
in its own words, and an adapter implements them. Which adapter runs is chosen by the environment,
so picking a different vendor later is an adapter plus an env change rather than a refactor.

Two details make the pattern worth having. A `none` adapter is a real implementation, not an `if` in
every route: with video set to `none` the platform answers that it does not run live classes, and no
caller has to guess. And the caller mints the storage key — an endpoint asks for a uuid rather than
trusting a filename, because a filename is not unique across teachers and a lesson id is guessable.

Payment is the port that is deliberately still a plan. A course carries a price and nothing is
charged; `PAYMENT_PROVIDER` defaults to `none` so that no code can pretend otherwise.

**Phase 9 update:** The coupon and payment system is now in place. Teachers can issue discount codes
per course, each carrying a percentage or fixed-amount discount, validity windows, and usage caps.
When a student enrolls with a valid coupon code, the enrollment endpoint validates the code against
the course, calculates the discounted price, creates a payment record linking the enrollment to the
coupon used, and increments the redemption counter — all within the same database transaction that
opens the place. The payment provider remains behind its port (currently set to `mock` for development),
so the financial ledger exists regardless of which vendor processes the actual transaction.

## One session, four doors

An access token lives in the portal's memory and is sent as a bearer header. The refresh token never
appears in a response body: it travels only as an `HttpOnly` cookie, and a rotation writes a new row
rather than editing the old one, so a stolen token is useless the moment its owner refreshes.

Because that cookie is scoped to a domain the three portals share, signing in as a student and then
opening the teacher's portal does not give you two sessions — the refresh slot holds one account.
That is deliberate for a POC, and it is the reason each portal re-reads `/auth/me` on a full page
load instead of trusting what it remembered.

## The work nobody asked for

Two scheduled jobs do the things a teacher and a student both expect to have happened without either
of them pressing a button. Every five minutes the outbox is claimed and delivered, with a retry
budget and a failure reason kept on the row. Every hour a booking request that nobody answered
expires, releasing the minute it was holding.

Both write their own kind of history. The expiry sweep records an action whose actor is `system`, so
a reader of the activity log can tell a scheduler's work from a person's decision without inferring
it from an empty field.

## Nothing here is deleted

A row that stops being useful gets `isActive = false` and stays, and every relation is
`onDelete: Restrict`, so a delete that would take somebody's history with it is refused by the
database rather than carried out quietly. The one exception is the ledger, which is allowed neither
an edit nor a retirement — see [The data model](/docs/data-model).

Two consequences worth knowing before you write a query: a retired row still holds its business key,
so a slug, an email or a subject pair stays reserved after its owner is archived; and a roster, a
class list or a count is read from the rows that survived, never copied onto a parent row that would
then disagree with them.

## How it is checked

`bun run verify` is the gate: build the shared package, typecheck, lint, then test — one package
after another, in that order, stopping at the first failure. Tests are written before the code they
describe. The API suite boots the real application through HTTP rather than mocking it, so guards,
filters, the prefix and validation are exercised as shipped.

These pages are part of the same discipline. The route table is reflected out of the application's
own module graph — imported, not booted, so no port is opened and no database is asked — and the
table of columns out of the schema file, both committed as generated artifacts; a spec
compares each committed file against what the code says now, so changing an endpoint or a table
without re-exporting turns the gate red instead of publishing a stale page.

## Where to go from here

- [The API reference](/docs/api-reference) for every route, its access rule and the status it answers.
- [The data model](/docs/data-model) for every table, column, pointer and key.
- [Rules the code enforces](/docs/conventions) for the constraints the rest of the design relies on.
- [The phase record](/docs/phases) for what has been built, in what order, and what has not.
