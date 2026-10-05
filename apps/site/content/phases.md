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
**Not started** is a promise still in the plan. No row above reads `Partial` or `Not started` today, and
the words stay because a row can earn them again — the two notes below are what each `Done` stops at.

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
so it says Done for the same reason the record does. Money and the calendar are the two rows whose notes
have to be read along with them, and what each of those means is below.

**Money, as far as it goes (Phase 9).** A teacher issues discount codes on a course — a percentage or a
fixed amount off the quoted price, a validity window, an optional cap on redemptions, and a counter of
uses — at `/courses/:courseId/coupons`, managed from the course's own screen. A learner types a code
where the enroll button is. A valid one prices the place at the discount; an expired, exhausted or
unknown code is refused before anything is written. A free course opens the place on that press and
files no payment row at all. A priced one does not: the place is written closed with a `pending` attempt
quoting the amount beside it, `POST /enrollments/:id/pay` asks the provider for that money, and the place
opens exactly when the attempt comes back `completed`. `GET /enrollments/held` lists the attempts waiting
on the learner, so a reload finds the same hold rather than a second quote, and a place whose newest row
is `completed` is never on that list. A refused charge leaves the place shut and the refusal in the
ledger, and the next press quotes the same number the learner already saw.

The money itself does not leave the machine. There is a payment port behind `PAYMENT_PROVIDER` — that
was the phase's missing half — but the only adapters shipped are `mock`, which answers `completed` and
derives a reference from the attempt's own id, and `none`, which says plainly that this build takes no
money. **No card is charged and no vendor SDK is wired in**, by decision: a gateway replaces one adapter
and nothing else, and the failure path is real because tests hand the service a provider that answers
`failed`.

**The calendar, now answered at both ends (Phase 10).** A course keeps a weekly series — Monday, 09:00 to
10:00, a 45-minute class, repeating until retired — and a teacher keeps holidays, single dates or ones
that return each year. Both now have consequences. A sweep reconciles them into dated classes over the
next thirty days, so a series stands for real classes on the teacher's `/calendar`, a marked-off day
takes that date's classes out and puts them back when it is lifted, and a student meets the same rows on
their own list beside the classes they booked. A dated class carries the register its course implies: a
name holding a place, with `present` or `absent` beside it once the teacher says so at
`/calendar/class/{id}`, and nothing at all about a name nobody has marked. The day off now reaches past
the sweep as well — a marked date leaves the booking grid too, so a student is never offered a minute
their teacher is away for. The one-to-one class at the end of the phase is answered too:
`POST /bookings/:id/attendance` writes `completed` or `no_show` onto the booking itself, since a 1:1 has
one name on the sheet and it is the person who asked, so there is no register to mark beside it. The
word is refused before the class's first minute has passed and accepted any time after it, which is how
a class forgotten on Thursday is still markable on Monday.

## Where the reasoning lives

Each phase has a section in `ARCHITECTURE.md` in the repository, numbered so a line of code can cite
the argument that produced it. [How the system fits together](/docs/guide) is the reader's version of
the same material, and [What this is](/docs) states plainly which screens are real today.
