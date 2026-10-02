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

Creates a new holiday date entry to block classes on that date for the calling teacher.

## PATCH /api/v1/availability/holidays/:id

Updates an existing holiday date, reason, or recurring annual status.

## POST /api/v1/availability/holidays/:id/retire

Retires an existing [[holiday]] so that date is no longer blocked.

## GET /api/v1/bookings

Lists bookings filtered by role. Teachers see bookings for their own courses; students see their own enrollments; ops sees everything. Query parameters support filtering by course, status, and date range.

Each booking record carries its current state (`requested`, `confirmed`, `refused`, `cancelled`) and the room assignment if one exists.

## POST /api/v1/bookings

Requests a new booking for a specific availability slot. The request body identifies the slot, the course, and any special requirements. The server checks for calendar conflicts and capacity limits before creating the booking in `requested` state.

Automatic confirmation may occur if the teacher has enabled [[instant-book]]; otherwise the teacher must explicitly confirm or refuse.

## POST /api/v1/bookings/:id/cancel

Cancels a booking that has not yet occurred. Students may cancel their own bookings; teachers may cancel bookings for their courses; ops may cancel any booking. Cancelled bookings free the slot for other students.

Cancellation policies (refund windows, penalties) are enforced server-side and not exposed in the API contract.

## POST /api/v1/bookings/:id/confirm

Moves a booking from `requested` to `confirmed`. Only the teacher who owns the slot, or ops staff, may confirm a booking. Confirmation locks the [[slot]] and prevents other students from requesting it.

## POST /api/v1/bookings/:id/reject

Moves a booking from `requested` to `refused`. The teacher provides an optional reason; the student is notified through the outbox system. Rejected bookings free the slot immediately.

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

Lists available time slots generated from active availability rules. Slots are computed on demand for a given date range; they reflect current rules, existing bookings, and capacity limits.

Query parameters control the date range, course filter, and teacher filter. Slots already booked are excluded from the response.

## GET /api/v1/classes/teaching

Lists the dated classes a teacher teaches, soonest first. Each row names the course, the start and end instants, how long the class runs and how many students are expected — the number that tells a teacher whether Monday is a lesson or a room full of people.

There is no matching write. A [[dated class]] is what a [[series]] comes to at a particular minute, so it is produced by the generation sweep rather than asked for: `from` and `to` bound the window, and leaving both out returns the thirty days the sweep keeps filled. A window wider than those thirty days is refused with `400` — nothing is written that far ahead, so the ask would only gather every class this caller owns into one response.

## GET /api/v1/classes/learning

Lists the classes a student is standing for, soonest first, each carrying their own attendance mark or nothing at all — an unanswered class reads as blank rather than as a word the platform invented for it.

These are the [[cohort class]]es: a course the reader holds a [[place]] in, meeting on its teacher's plan rather than on anything this student pressed. The list is read from those places rather than from one class's [[register]], which is how somebody who enrolled five minutes ago sees the term they just joined. The same `from`/`to` window applies.
