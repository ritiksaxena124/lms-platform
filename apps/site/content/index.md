# What this is

Hourloom is where one-to-one and small-group classes with independent teachers get taught, booked and
kept. A teacher writes the course and opens the week they teach; a learner reads it, takes a place, and
asks for a minute of that teacher's time. The software's job is the part a calendar and a group call
never handled: the asking, the answering, the room, and the record.

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

Postgres holds the data and Prisma speaks to it. Third-party systems — mail, video, object storage,
money — sit behind ports the application defines, so the platform has an opinion about what sending an
email or collecting a payment means and can change who actually does it without re-deciding that.

## What is real today

Courses with modules, lessons and an attached recording. A free page of a paid course. Enrollment, with
a discount code a teacher issued; where the course carries a price, the place is written closed beside a
`payment` row that starts as a pending attempt, and it opens when that attempt is reported collected. A
teacher's availability drawn on a calendar in their own time zone, and the requests that come out of it.
A room for the class that opens in its window and not a minute before. A class a student booked, ended as
taught or missed by the teacher who kept it. Email at each turn of that loop. A log of who changed what,
and a screen that reads it back.

What is not: money that moves. The price is real, the gate is real, and the port behind it answers
`mock` — no payment provider is wired in and none is planned, so a `payment` row is a record rather than
a receipt. And discovery: a teacher is
found by a link someone sent you, not by a search that ranks them.

## Where to go next

[Run it locally](/docs/running-it-locally) takes you from a clone to a signed-in browser.
[Rules the code enforces](/docs/conventions) explains the handful of constraints that make the rest
of the design safe to rely on.
