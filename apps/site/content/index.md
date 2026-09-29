# What this is

A marketplace for one-to-one and small-group classes with independent teachers. A teacher writes the
course and opens the week they teach; a learner reads it, takes a place, and asks for a minute of that
teacher's time. The software's job is the part a calendar and a group call never handled: the asking,
the answering, the room, and the record.

These pages describe the system that is actually built. Where something is a plan rather than a
running screen, it says so.

## The shape of it

One API, four front ends, one database, one component library. There are no services, no queue, no
cache tier and no search engine — a proof of that size would spend its whole budget on plumbing, and
the interesting decisions here are about a teacher's minutes, not about distributed systems.

| Piece             | What it holds                                                                |
| ----------------- | ---------------------------------------------------------------------------- |
| `apps/api`        | A NestJS modular monolith. Every rule about who may do what lives here.      |
| `apps/teacher`    | The workspace a teacher authors in, and the desk their classes are run from. |
| `apps/student`    | The shelf a stranger reads, and the place a learner books and attends.       |
| `apps/ops`        | The operator's view: accounts, the notification queue, and the activity log. |
| `apps/site`       | This page and these docs. Static files, no server.                           |
| `packages/ui`     | One component library shared by all four front ends.                         |
| `packages/shared` | The vocabulary both sides of the wire agree on: codes, money, time zones.    |

Postgres holds the data and Prisma speaks to it. Third-party systems — mail, video, object storage —
sit behind ports the application defines, so the platform has an opinion about what sending an email
means and can change who actually does it without re-deciding that.

## What is real today

Courses with modules, lessons and an attached recording. A free page of a paid course. Enrollment. A
teacher's availability drawn on a calendar in their own time zone, and the requests that come out of
it. A room for the class that opens in its window and not a minute before. Email at each turn of that
loop. A log of who changed what, and a screen that reads it back.

What is not: payment. A course carries a price and nothing is charged. A repeating schedule — one
booked minute is a class, a week that repeats itself is not built yet. And discovery: a teacher is
found by a link someone sent you, not by a search that ranks them.

## Where to go next

[Run it locally](/docs/running-it-locally) takes you from a clone to a signed-in browser.
[Rules the code enforces](/docs/conventions) explains the handful of constraints that make the rest
of the design safe to rely on.
