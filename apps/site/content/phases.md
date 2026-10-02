# The phase record

The build was planned as twelve phases and ran to thirteen, and this table is the record of where each
one stands. It is not a copy: the page reads the phase table out of the repository's own README at build
time, so there is one list of what was promised and it cannot disagree with itself. When a phase closes,
the row changes here because it changed there — including when it closes only halfway.

```phases

```

## How to read a status

**Approved** means the plan for that phase was agreed and work had not started. **Done** means the
tests pass, the behaviour was checked in a browser by hand, and the next phase was approved — a phase
is not finished when it compiles. **Partial** means the records and the screens are there but the part
that changes what an older feature does is not: read the note beside the row before trusting it.
**Not started** is a promise still in the plan.

## What the record says

The first eight phases are the product: a teacher authors a course and opens the week they teach, a
learner reads it and asks for a minute of that time, the class happens in a room that opens only in
its window, the news of each turn reaches an inbox, and somebody's decision is recorded well enough
that an operator can read it back.

The last four are what a stranger would want before trusting the build with a class: money, a
teacher's repeating calendar, the public face of the marketplace, and these docs — the phase that
turns what `ARCHITECTURE.md` already argues into pages somebody outside the repository can read, plus
one phase after it that explains every endpoint rather than only listing it. The face and the manual
are standing, and this page is one of them: the row above it is read from the repository's own record,
so it says Done for the same reason the record does. Money and the calendar are the two that stopped
halfway, and what "halfway" means for each is below.

**Money, as far as it goes (Phase 9).** A teacher issues discount codes on a course — a percentage or a
fixed amount off the quoted price, a validity window, an optional cap on redemptions, and a counter of
uses — at `/courses/:courseId/coupons`, managed from the course's own screen. A learner types a code
where the enroll button is. A valid one prices the place at the discount and writes a `payment` row in
the same transaction that opens the place; an expired, exhausted or unknown code is refused before the
place opens. That is the whole of it: **nothing is charged.** There is no payment port behind
`PAYMENT_PROVIDER`, so the amount on a `payment` row is what the class costs, not money that moved.

**The calendar, executed but unanswered (Phase 10).** A course keeps a weekly series — Monday, 09:00 to
10:00, a 45-minute class, repeating until retired — and a teacher keeps holidays, single dates or ones
that return each year. Both now have consequences. A sweep reconciles them into dated classes over the
next thirty days, so a series stands for real classes on the teacher's `/calendar`, a marked-off day
takes that date's classes out and puts them back when it is lifted, and a student meets the same rows on
their own list beside the classes they booked. What the phase still does not do is answer them: every
dated class carries a register of the names holding a place and nothing marks one taught or missed, and
**the booking grid still expands the availability windows alone** — deliberately, since a cohort class is
a timetable rather than minutes to claim, but it is the promise the phase was scoped with and it is on
the row above.

## Where the reasoning lives

Each phase has a section in `ARCHITECTURE.md` in the repository, numbered so a line of code can cite
the argument that produced it. [How the system fits together](/docs/guide) is the reader's version of
the same material, and [What this is](/docs) states plainly which screens are real today.
