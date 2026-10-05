# Booking and availability API

Teacher availability windows and student booking workflows live here. A teacher publishes rules describing when they can teach; students request slots; the system confirms or refuses based on capacity and calendar conflicts.

## GET /api/v1/availability/rules

Lists every availability rule a teacher has published. Each rule describes a recurring window — day of week, start time, end time — and whether it is still active. The response includes the rule ID so a caller can update or [[retire]] it later.

Only authenticated teachers may call this route. The response contains only rules belonging to the caller's profile.

## POST /api/v1/availability/rules

Creates a new availability rule for the calling teacher. The request body supplies the day of week, start and end times, and optional timezone information. The server validates that the window is non-empty and that the day is valid.

A teacher may have many overlapping rules; the scheduler resolves conflicts at booking time rather than at rule creation.

## PATCH /api/v1/availability/rules/:id

Updates an existing rule. Only the fields supplied in the request are changed; omitted fields retain their current values. A rule cannot be reactivated once retired — create a new rule instead.

The caller must own the rule; ops staff may edit any rule.

## POST /api/v1/availability/rules/:id/retire

Marks a rule as inactive without deleting it. Retired rules remain visible in history but no longer produce bookable slots. This operation is irreversible.

## GET /api/v1/availability/holidays

Lists all holidays (blocked teaching dates) scheduled by the authenticated teacher.

## POST /api/v1/availability/holidays

Creates a new holiday date entry to block classes on that date for the calling teacher. The day leaves the cohort calendar, and the same day leaves the [[slot]] grid a student books from — a teacher who is away is not offered.

## PATCH /api/v1/availability/holidays/:id

Updates an existing holiday date, reason, or recurring annual status.

## POST /api/v1/availability/holidays/:id/retire

Retires an existing [[holiday]]. The date teaches again — its cohort classes come back on the next sweep and the booking grid offers that day once more.

## GET /api/v1/bookings

Lists the classes the signed-in student asked for or was granted. Every row is read through the session and no id in an address picks somebody else's list. Asking at this address is a student's capability (`booking.request`): a teacher reads the same table from the other side through the requests and class-list routes below, and an operator has no route to it at all.

Each booking record carries its current state (`requested`, `confirmed`, `refused`, `cancelled`) and the room assignment if one exists.

## POST /api/v1/bookings

Requests a new booking for a specific [[slot]]. The request body identifies the course and the minute. The server asks that minute the same questions the grid was built from — a window open then, no standing class running through it, and a date the teacher has not marked off — and refuses one that fails any of them as a `startsAt` validation error rather than writing a booking it would later have to cancel.

Automatic confirmation may occur if the teacher has enabled [[instant-book]]; otherwise the teacher must explicitly confirm or refuse.

## POST /api/v1/bookings/:id/cancel

Cancels a booking that has not yet occurred. Students may cancel their own bookings; teachers may cancel bookings for their courses; ops may cancel any booking. Cancelled bookings free the slot for other students.

Cancellation policies (refund windows, penalties) are enforced server-side and not exposed in the API contract.

## POST /api/v1/bookings/:id/confirm

Moves a booking from `requested` to `confirmed`. Only the teacher who owns the slot, or ops staff, may confirm a booking. Confirmation locks the [[slot]] and prevents other students from requesting it.

## POST /api/v1/bookings/:id/reject

Moves a booking from `requested` to `refused`. The teacher provides an optional reason; the student is notified through the outbox system. Rejected bookings free the slot immediately.

## POST /api/v1/bookings/:id/attendance

Marks attendance for a confirmed one-to-one booking. Only the teacher who owns the booking may mark attendance, and only after the class's first minute has passed. The body carries `status`, which must be either `completed` or `no_show` — the two endings a 1:1 class can have, since there is no register beside it.

The write is idempotent: pressing the same status again answers `200` without writing, while pressing the other status on an already-marked class answers `409`. A cancelled, expired or still-unanswered booking also answers `409`, because nothing was taught.

## POST /api/v1/bookings/:id/room

Assigns a physical or virtual room to a confirmed booking. The request body supplies the room identifier and optional connection details (URL, dial-in number). Only ops staff may assign rooms.

A room assignment may be updated multiple times until the booking occurs.

## GET /api/v1/bookings/classes

Returns upcoming class sessions derived from confirmed bookings. Each entry includes the course name, module title, scheduled time, and room details if assigned. Students see only classes they are enrolled in; teachers see classes they are teaching.

This endpoint aggregates across multiple bookings to present a unified calendar view.

## GET /api/v1/bookings/requests

Lists bookings in `requested` state awaiting teacher action. Teachers see pending requests for their own courses; ops sees all pending requests across the platform.

Each request includes the student's name, the requested slot, and how long the request has been pending.

## GET /api/v1/bookings/slots

Lists the [[slot]]s a student may ask for in one course: the teacher's week expanded into instants, minus the minutes a standing class still holds and minus every day the teacher has marked off as a [[holiday]].

`course` is the only parameter — the id the API issued or the slug a catalog link carries. The response also says who the reader is to the course (`entitlement`, and `denial` when it is nothing), because "enroll first" and "you already used your trial call" are two screens rather than one empty list. Nothing is stored about a slot: the grid is worked out on every read, so a window edited or a day retired shows up on the student's calendar with no table to keep in step — and the booking write asks the same questions of the same minute, so a square is offered exactly when it can be taken.

## GET /api/v1/classes/teaching

Lists the dated classes a teacher teaches, soonest first. Each row names the course, the start and end instants, how long the class runs and how many students are expected — the number that tells a teacher whether Monday is a lesson or a room full of people.

There is no matching write. A [[dated class]] is what a [[series]] comes to at a particular minute, so it is produced by the generation sweep rather than asked for: `from` and `to` bound the window, and leaving both out returns the thirty days the sweep keeps filled plus a week behind now — a class stays on the calendar after its own start minute, which is when the [[register]] under it is actually being marked. A window wider than that stretch of thirty-seven days is refused with `400` — nothing is written that far ahead, so the ask would only gather every class this caller owns into one response.

## GET /api/v1/classes/learning

Lists the classes a student is standing for, soonest first, each carrying their own attendance mark or nothing at all — an unanswered class reads as blank rather than as a word the platform invented for it.

These are the [[cohort class]]es: a course the reader holds a [[place]] in, meeting on its teacher's plan rather than on anything this student pressed. The list is read from those places rather than from one class's [[register]], which is how somebody who enrolled five minutes ago sees the term they just joined. The same `from`/`to` window applies — including the week it reaches behind now, which is what keeps yesterday's mark on a class this student sat in.

## GET /api/v1/classes/:id/roll

Reads one [[dated class]]'s [[register]] as the sheet a teacher marks: the class's course and window, the names it stands for with the mark on each, and `canMark` saying whether a mark may be written yet.

The names are the students holding an open place in the course at the moment of the read, alphabetical, and a departed student is not among them — their row stays in the table with whatever mark it carried, because "who was meant to be there" is a fact about that day. Nothing else about a student travels: no address, no joined-on date. A teacher marks a name, and a name is the whole question.

`canMark` is the server's clock rather than something a screen works out for itself, because the two would disagree by whatever the visitor's device is off, and the disagreement would be a save button on a class that has not happened yet. It stays true forever after the class starts: a register forgotten on Monday is a register that can still be filled in on Thursday.

Asks for `class.teach`, and a class that is retired or belongs to another teacher answers `404` with the same sentence either way.

## PUT /api/v1/classes/:id/roll

Writes the marks: a list of `{ studentId, status }` for one class, applied as one transaction.

The save is the whole sheet because that is the act — somebody goes down the names after the lesson — and a line the body does not mention keeps whatever mark it already carried. A `status` of `null` clears a mark, which is a correction rather than a non-answer: a name marked absent by mistake goes back to nobody having said anything, not to a word the platform invented. The two words are `present` and `absent`; anything else answers `400`, as does a name this class is not standing for and a name sent twice.

A class that has not started answers `409` rather than writing anything, and the response is the [[roll]] read back after the write, so a screen renders the table's answer instead of the one that was typed. No dated class is created or moved here: the [[series]] still owns the minute, and this writes beside it.
