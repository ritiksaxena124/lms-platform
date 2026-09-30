# The catalog and enrollment

Eight routes, in the order a student meets them: the five that let anyone browse the shelf and read what is open, and the three that turn browsing into a place — taking it, listing the places one holds, and leaving.

Under each heading is the contract the code holds for that route — who gets past the guard, what the body has to look like, what a success answers with, and which class serves it. That part is not typed out here: a command reads it off the decorators and the shared types on every gate, so a field renamed in the API is renamed on this page in the same commit. What is written here is the half a machine cannot supply — what the route is for, and what it does when the answer is no.

## GET /api/v1/catalog/courses/levels

The levels a course can be filtered by, in the order the catalogue sets. Anybody may call this — no session, no role — because a browser needs to know what filters exist before it can ask for a page of results.

The answer is a list of `{ code, label }` pairs, where `code` is the stable identifier the API uses and `label` is what a screen shows. A level that has been retired does not appear here, which is why a filter set to a code from an old bookmark comes back as a validation error rather than an empty shelf.

## GET /api/v1/catalog/courses

The shelf: published courses, newest first, paginated. Anybody may call this — no session, no role — and the answer is the same for everybody, because a course's published status is a fact about the row, not about who is looking at it.

Four optional query parameters shape the list: `level` filters to one level (a code from [the levels endpoint](/docs/api-catalog#get-catalog-courses-levels)), `q` searches the title and summary (two characters minimum, so a half-typed word does not return the whole table), and `page` with `pageSize` walk the result. `pageSize` defaults to 12 and is capped at 100; `total` counts everything the filters matched rather than the rows on this page.

Each card carries the course id, slug, title, summary, level, teacher name, module count, lesson count, price (or `null` if the teacher has not quoted), and `updatedAt`. The counts are gated counts: a module is counted only while it still has lessons in it, and a lesson only once both its own status and the course around it are published, so the number on a card is the number of pages the detail will actually list. A card that promised nine and opened onto four would teach a student to distrust it.

A level code that is not on the platform's list answers `400` with `VALIDATION_FAILED` and `details.validation.level`, because the list is editable by operators and a form that offers a stale value needs to be told, not forgiven.

## GET /api/v1/catalog/courses/:id

One course's outline: the syllabus, and on it which rows this reader may open. The session is optional here — a stranger reaches the shelf, the syllabus and whatever the teacher left open, while a signed-in student who holds a place sees more doors unlocked.

The address accepts either the course's UUID or its slug, since a slug is written by hand and pasted into a URL. A non-UUID is read as a slug rather than refused, and both spellings reach one row. A course that is not published, never existed, or was archived answers `404` with `NOT_FOUND` and "We cannot find that course." — one message for three states, because a browser that could tell them apart has a list of draft courses to work from.

The answer is the card's fields plus the description and the full syllabus. Each module lists its lessons with `isFreePreview` (the teacher's statement about the page) and `isReadable` (whether this reader may open it). For a stranger the two agree; a student holding a place reads every published page of the course either way. `isFreePreview` travels alongside `isReadable` unchanged, because it is the teacher's statement about the page rather than a description of how this reader got in — a badge and a door are two different facts.

## GET /api/v1/catalog/courses/:id/lessons/:lessonId

One page, opened — for a stranger if the teacher marked it free, for a student who holds a place in the course otherwise. The session is optional for the same reason it is on the outline above, and the answer changes one boolean, never the list of rows.

The lesson id must be a UUID; anything else earns `404` with "We cannot find that page." A page that exists but is not published, or belongs to a different course than the one in the path, also earns `404` — the same silence as one never written, because telling a caller which half of the address was wrong would be telling them which pages exist.

The answer carries the page's title, body, estimated minutes, position, `isFreePreview`, the recording info (or `null` because there is none), `updatedAt`, and the module and course it hangs from. The module and course are sent because a reader who arrived here from a link has no syllabus on screen and needs both to go back. `isFreePreview` says whether the teacher marked this page free — and it is `false` for a page that opened because of who asked, because the flag is the teacher's statement about the page, not a description of why the reader got in.

The recording info has `displayName` (what the teacher called the file) and `bytes` (how long it is), and nothing that could be turned into an address. The bytes themselves have no URL on this platform, so the two facts a screen can honestly use are what the teacher called the file and how long it is.

## GET /api/v1/catalog/courses/:id/lessons/:lessonId/video

The recording on a page, streamed to whoever that page opens for. The session is optional, and the same two doors as the page above apply — the teacher's free preview, or this reader's place in the course. What differs is the shape of the answer: this is the file, in whatever piece the player asked for, so the route takes the response over rather than returning a body for a serialiser to render.

The route supports HTTP range requests, answering `206` with the requested byte range when a player asks for a piece of the file. This is how a video player seeks without downloading the whole thing first. A request with no `Range` header streams from the beginning; a malformed range earns `416 Range Not Satisfiable`.

A page with no recording attached answers `404` with `NOT_FOUND` and "No recording stands on that page." — distinct from the page itself being missing, because a student told "no recording" by a 404 cannot tell that from a door that closed on them mid-read. A course or lesson that does not exist, or one the caller may not read, also answers `404` with the same message, since the recording's door is the page's door.

There is no URL for these bytes anywhere else in this API, which is what makes this the only way to hear them.

## POST /api/v1/enrollments

Take a place in a course. `student` role required — teachers and operators cannot reach this route at all, because a teacher cannot enroll in their own work and an internal account does not hold a place.

The body is `{ courseId }`, where `courseId` is the UUID of the course to join. There is no "as which student" — the session answers that, and a body that could name somebody else would be a way to take a place in a stranger's name. And there is no "as of" date, no note, no intended start: those are booking decisions, and a place in a course is not an appointment.

Taking a place is idempotent. Pressing the button twice is one event: the write finds the row that already exists — open, or left behind when the student went away — and answers with it rather than with a conflict or a duplicate. That is also why the route replies `200` on a first enrollment instead of `201`: two status codes for one button would ask the portal whether it had been clicked before.

A course that is not published, never existed, or was archived answers `404` with `NOT_FOUND` and "We cannot find that course." — the same message the catalog gives, because enrolling in a draft would be a way to walk a teacher's unpublished work with a form.

On success, the answer is `{ enrollment: { id, course: { id, slug, title }, isActive, enrolledAt, updatedAt } }`. `enrolledAt` is the day the place was first taken, not the day it was last reopened — the row was never replaced, so the date never moved.

## GET /api/v1/enrollments

The caller's own open places, newest first, and only in courses still on the shelf. `student` role required.

The answer is `{ items: [...] }`, where each item has `id`, `course: { id, slug, title }`, `isActive`, `enrolledAt`, and `updatedAt`. Only active enrollments in published courses appear here, so nothing on the screen leads to a page that will not open. A student who left a course and came back sees one row, not two — the place was reopened, not replaced.

There is no pagination: a student's list is read on a screen, not exported, so a page is what fits on one. If the list grows beyond that, the design decision is to show the most recent and let the student search, not to add pages nobody asked for.

## POST /api/v1/enrollments/:id/cancel

Leave a place. `student` role required, and the id here is the enrollment's, not the course's — the caller's own list sends it, and leaving is a decision about a place one already holds rather than about a course.

A second cancel is not an error the portal has to explain, so a place that is already closed is returned as it is rather than refused. It is the same clause that files no news, and no record, for it: the write only matches a row that is still open, so leaving twice tells the student they left once. The row itself stays: it is the record of an access that happened, and the pages read under it were opened by this enrollment.

An enrollment that does not exist, or belongs to somebody else, answers `404` with `NOT_FOUND` and "We cannot find that enrollment." — which enrollment exists is not a fact about the caller, so a stranger's id and a made-up id earn the same silence.

On success, the answer is `{ enrollment: { id, course: { id, slug, title }, isActive: false, enrolledAt, updatedAt } }`. `isActive` is now `false`, but `enrolledAt` has not moved — the day the place was first taken is still the day it was first taken, and a student who left and came back did not move it.
