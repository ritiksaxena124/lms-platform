# The data model

Sixteen tables. The list below is generated from `apps/api/prisma/schema.prisma` by
`bun run --filter @lms/api docs:data`, so every field name on this page is the name a query has to
use — and a schema change that has not been re-exported fails the test suite rather than printing a
page that looks like last month.

## What every table has

The same five things, in the same shape:

- an `id` holding a uuid the database mints, never a number a client could guess;
- `created_at` and `updated_at`, the second one written by Prisma rather than by the code that
  saved the row;
- `is_active`, because nothing here is deleted — a row that stops being useful is set to `false` and
  stays, which is what lets a past booking still name the teacher who took it;
- a snake_case table name under every camelCase model, so `teacherUserId` in code is
  `teacher_user_id` in the database;
- and `onDelete: Restrict` on every pointer, so a delete that would take somebody's history with it
  is refused by the database instead of quietly carried out.

One table gives up two of those: `action_log` carries no `is_active` and writes no `updated_at`.
[Rules the code enforces](/docs/conventions) explains why a record of what somebody did is allowed
neither, and the list below marks that table in its own line so a reader does not have to know the
exception in advance to spot it.

Which statuses a column may hold, and what may follow what, is not here. Those are lookup rows and
service rules — see [What the API will not do](#what-the-api-will-not-do).

## Reading a section

Each table is listed once, with its columns under both names.

**Field** is what the code writes; **Column** is what the database stores; **Type** is Prisma's own
notation, where `DateTime?` means the row may hold nothing and `String[]` means it may hold several.

A table's pointers are printed in both directions. **Points at** lists the rows this one names — the
field, the table it leads to, the column carrying the key, and what happens when the far row goes
away. **Held by** is the same relation read from the other end, and it is printed because the schema
states each pair once: a reader of `users` would otherwise see an account with no bookings, no
courses and no history attached to it.

**Cannot repeat** lists the keys, under the names the table stores them. A pair like
`teacher_user_id` + `slot_held_at` is a business rule the database is asked to hold even under
concurrency — two students cannot claim one minute of one teacher's calendar — while a single column
like `email` is an identity that stays reserved after the account behind it is retired.

## The tables

```data-model

```

## Why the exceptions are worth two sentences

`action_log` has no `is_active` and no `updated_at`. A flag saying a row was retired would be a
record that somebody decided to stop believing it, and a column saying when it was edited is an
invitation to edit what somebody else did. A correction there is a second row.

`lkp_value` is the other shape worth noticing: one table holds roles, account statuses, course
levels, course statuses, currencies, subjects, lesson statuses, and the kinds and statuses of
bookings. That is not tidiness — those lists are things an operator may need to change without a
deploy, so they are rows rather than enums, and the columns that name them are foreign keys. The
**Held by** list on that section is the honest count of how many questions one table answers.

## What the API will not do

Nothing on this page enforces a business rule, and that is deliberate.

- A status is a lookup row; which statuses a given change may move between is checked in the service
  that writes it.
- Whether a student may take a place — course published, student not the owner — is decided by the
  endpoint that writes the enrollment, not by a constraint.
- A price is a number on a row, not a receipt. Nothing in the schema moves money, and no column
  pretends otherwise: the enrollment endpoint files the amount as a `payment` row whose status says
  whether the money has arrived, and a real gateway would be an adapter behind the `payment` port
  rather than a column here.
- How many times a notification retries is a number in the shared package, compared against
  `attempts` by the sweep that owns it.
- One demo call per student per course is a count over the rows that survived. A unique key would
  have frozen the cap at one forever, and the cap is a business number somebody will eventually
  want to change.

The same split runs the other way where it matters most: the race that keeps two bookings off one
minute _is_ a constraint, because no check-then-insert written in application code can win that
argument against two requests arriving in the same instant.

## Related pages

- [The API reference](/docs/api-reference) for the routes that read and write these rows.
- [Rules the code enforces](/docs/conventions) for the conventions above and what checks them.
