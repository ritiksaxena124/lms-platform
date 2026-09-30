# The phase record

The build was planned as twelve phases, and this table is the record of where each one stands. It is
not a copy: the page reads the phase table out of the repository's own README at build time, so
there is one list of what was promised and it cannot disagree with itself. When a phase closes, the
row changes here because it changed there.

```phases

```

## How to read a status

**Approved** means the plan for that phase was agreed and work had not started. **Done** means the
tests pass, the behaviour was checked in a browser by hand, and the next phase was approved — a phase
is not finished when it compiles. **Not started** is a promise still in the plan.

## What the record says

The first eight phases are the product: a teacher authors a course and opens the week they teach, a
learner reads it and asks for a minute of that time, the class happens in a room that opens only in
its window, the news of each turn reaches an inbox, and somebody's decision is recorded well enough
that an operator can read it back.

The last four are what a stranger would want before trusting the build with a class: money, a
teacher's repeating calendar, the public face of the marketplace, and these docs — the phase that
turns what `ARCHITECTURE.md` already argues into pages somebody outside the repository can read. Two
of those four are standing now, and this page is one of them: the row above it is read from the
repository's own record, so it says Done for the same reason the record does.

What remains genuinely unbuilt is the part involving money: coupons and payments (Phase 9), and the
teacher's repeating calendar (Phase 10). A course carries a price today and nothing is charged for it.

## Where the reasoning lives

Each phase has a section in `ARCHITECTURE.md` in the repository, numbered so a line of code can cite
the argument that produced it. [How the system fits together](/docs/guide) is the reader's version of
the same material, and [What this is](/docs) states plainly which screens are real today.
