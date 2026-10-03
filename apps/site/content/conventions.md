# Rules the code enforces

These are the constraints that make the rest of the system safe to reason about. Each one is checked
by something other than a reviewer's memory, which is the only reason it is still true six phases
later.

## Nothing is destroyed

There are no hard deletes and no cascades. A row that stops being usable is deactivated with
`isActive`, and the foreign keys are set to `Restrict` so the database refuses the delete rather than
quietly taking a teacher's history with it.

`delete`, `deleteMany`, `truncate` and `dropTable` are ESLint errors across the workspace, so this
rule cannot be broken by accident in a file nobody read carefully.

The consequence for a reader: a course that was archived still has its modules, its enrollments and
its booked classes. The consequence for a designer: a unique constraint has to say which of two
things it is protecting — the identity of a row, or a business fact about it — because a learner who
left a course and came back is a different question from a learner who signed up twice.

## Vocabulary lives in rows, not enums

Roles, course statuses, lesson statuses, booking kinds, currencies: these are rows in `LkpType` and
`LkpValue`, not TypeScript enums and not Postgres enums. Adding a course level is a row and a
migration, not a release. The code strings themselves are typed in `@lms/shared`, so the compiler
still knows the names — the database holds the set, the code holds the vocabulary, and neither
invents a value the other has not seen.

Because reference data is rows, seeding it is part of starting the system, and the seeder has to be
safe to run while other processes are running it too.

**What a route lets its caller do is the exception.** A capability — `course.author`,
`booking.answer` — is named in a decorator on the route, so one that lived only in a table would be
a door no code opens. The list of capabilities and the table saying which roles hold them live in
`@lms/shared`, and they change in the same commit as the routes that ask for them. The roles
themselves stay rows: an operator issues accounts and changes what one is, which is a decision made
while the platform is running, not a release.

## Every failure has one shape

```json
{
  "statusCode": 409,
  "code": "CONFLICT",
  "message": "Only a draft can be published.",
  "requestId": "6f1c…",
  "timestamp": "2026-09-29T11:04:22.181Z"
}
```

`code` is one of a closed list that lives in `@lms/shared`, and it is what a client switches on;
which particular thing went wrong is a sentence in `message`, and that may be reworded whenever
somebody reads it carefully. So a refusal is a status and a code together — `409 CONFLICT` — and both
of those are stable while the words beside them are not. A validation failure adds
`details.validation`, keyed by field, which is how a form knows which input to turn red. `requestId` is the same value that appears in the log line and in the `x-request-id`
response header, so a report that says one identifier is enough to find the event.

Error bodies never carry a stack trace, a connection string, or an internal hostname.

## Time is stored in UTC and shown in a named zone

An availability rule is written in the teacher's zone, and a zone is a name — `Asia/Kolkata`, not
`+05:30` — because only a name knows that next month the offset is different. Instants are stored in
UTC and converted at the edge that shows them, which means a learner in another country sees the
same class at the hour that class actually starts for them.

Money is an integer in [[minor units]] plus a currency code. Never a float, and never a number whose
unit is a rumour.

## Third parties sit behind ports

Mail, video and object storage are interfaces the application defines, with an adapter that
implements them. A `none` adapter is a real implementation, not a placeholder: with no credentials
configured the platform still runs, it just does not send, host or stream. That is what keeps a
proof from being unable to boot until somebody buys something.

## The API decides, the portal only asks

Authorization is enforced server-side. A portal hiding a button is a courtesy to the person using
it, not a security measure, and the three portals share one API rather than each carrying a copy of
the rules. A learner who guesses the URL of another learner's enrollment gets a refusal, and the
refusal is the same one the button would have produced.

## Tests exist before the code does

A phase starts by making a failing test exist and showing it red. That is not ceremony: it is the
reason the rules above have evidence behind them rather than assertions.
