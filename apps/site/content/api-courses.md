# Courses, modules and lessons

Twenty-seven routes for everything a teacher authors: the course itself, the syllabus blocks inside it, the pages within those blocks, who holds a [[place]] in the class, and the recording attached to a lesson. Every route here is gated to `teacher` — a student or operator with a valid token is refused at the door with `403 FORBIDDEN`.

The id in each address is a lookup key, never a permission. The service resolves every call against the courses belonging to this session, so "not yours" and "not there" answer `404` with code `NOT_FOUND` and the sentence `We cannot find that course.` (or module, or lesson). That is deliberate: a colleague probing ids learns nothing about what exists on this platform.

## POST /api/v1/courses

Creates a new course owned by the calling teacher. The body requires `title` (4–120 characters) and `level` (a level code from [the levels endpoint](/docs/api-courses#get-courses-levels)), plus optional `slug`, `summary`, `description` and `price`. A slug not supplied is derived from the title; if the result is too short or already taken by another of this teacher's courses, the call answers `400` with code `VALIDATION_FAILED` and `details.validation.slug`.

A price is a pair: `{ minorUnits, currency }`. An amount without a currency is not a price, and neither is a currency standing over no amount. A currency code not found in [the currencies endpoint](/docs/api-courses#get-courses-currencies) answers `400` with `details.validation.price`. The course starts as `draft`, which is why `summary` and `description` are optional here but required before [publishing](/docs/api-courses#post-courses-id-publish).

Success answers `201` with `{ course }`, including the generated id and the `draft` status.

## GET /api/v1/courses

Lists the calling teacher's own courses. An optional query parameter `status` filters by status code (`draft`, `published` or `archived`). Success answers `200` with `{ items: Course[] }`, ordered newest first.

A teacher with no courses gets an empty array, not an error.

## GET /api/v1/courses/levels

Returns the active course levels, in the order the catalogue renders them. Success answers `200` with `{ items: CourseChoice[] }`, where each entry has a `code` (sent in bodies) and a `label` (shown to a person). This route exists so a form does not keep three strings of its own that go stale when Ops edits a row.

## GET /api/v1/courses/currencies

Returns the active currencies a price can be quoted in. Success answers `200` with `{ items: CourseChoice[] }`, where each entry has a `code` and a `label`. The picker is given both: the label to show and the code to send back in a price object.

## GET /api/v1/courses/:id

Reads one of the calling teacher's courses. The `:id` must be a valid uuid, or the call answers `404` before any ownership check — Postgres would otherwise return a syntax error about a typo. Success answers `200` with `{ course }`, including the current `status`, `level`, `price` (which may be `null`) and `demoBookingsEnabled`.

## PATCH /api/v1/courses/:id

Updates one of the calling teacher's courses. The body may contain any subset of `title`, `slug`, `summary`, `description`, `level` and `price`. A `price` of `null` clears both columns; omitting it leaves the quote unchanged. A slug change is checked for uniqueness among this teacher's other courses — a duplicate answers `409` with code `CONFLICT` and `details.validation.slug`.

A published course cannot be edited. The call answers `409` with `CONFLICT` and the sentence `Unpublish the course to change what a student is reading.` A body that sends every field back unchanged writes nothing and returns the course as-is, with its `updatedAt` untouched.

Success answers `200` with `{ course }`.

## POST /api/v1/courses/:id/publish

Moves a draft course to `published`. The call checks two preconditions: the course must be in `draft` status, and it must have both a `summary` and a `description` filled in. Failing the status check answers `409` with `CONFLICT` and `Only a draft can be published.` Missing text fields answer `400` with `VALIDATION_FAILED` and `details.validation` keyed on each missing field, with the sentence `Fill this in before publishing.`

Publishing is the only way a course reaches a student's shelf. Success answers `200` with `{ course }`, now showing `status.code: "published"`.

## POST /api/v1/courses/:id/unpublish

Moves a published course back to `draft`. The course must currently be `published`; a draft or an archived course answers `409` with `CONFLICT` and `Only a published course can be unpublished.`

This is the pause, not the end. A teacher who wants the title box back mid-week takes the course off the shelf rather than filing the run away, and the fields are editable the moment it lands in `draft` — which is why editing a live course is refused instead of half-allowed. Coming back off the shelf is always [publish](/docs/api-courses#post-courses-id-publish)'s own decision again, because putting a course in front of students is the transition that re-checks what a student would actually read.

Students who already hold a place keep reading the course while it is a draft. Success answers `200` with `{ course }`, now showing `status.code: "draft"`, and files a `course_unpublished` row in the [activity log](/docs/api-platform#get-actions).

## POST /api/v1/courses/:id/archive

Moves a published course to `archived`. The course must currently be `published`; a draft or already-archived course answers `409` with `CONFLICT` and `Only a published course can be archived.`

Archiving takes the course off the student-facing shelf, and it is the one move off the shelf that closes the door on the students inside it: filing a run away is the teacher withdrawing the teaching, so the catalog answers `404` for its outline and its pages to everyone, place-holders included. The enrollment rows themselves are untouched — a place is a record of what happened, not a switch — and the course's slug stays reserved.

Success answers `200` with `{ course }`, now showing `status.code: "archived"`.

## POST /api/v1/courses/:id/unarchive

Brings an archived course back, as a `draft`. The course must currently be `archived`; a draft or a published course answers `409` with `CONFLICT` and `Only an archived course can be brought back.`

A run that ends in November is written up again in January, and the work in between is editing — so this lands on the editable state rather than on the shelf. Going straight back to `published` would put a course in front of students that nobody has re-read since it was filed away, without running the check that [publish](/docs/api-courses#post-courses-id-publish) runs.

The students who held places here can read the course again as soon as it is a draft, because their places were never taken away — only the shelf was. Success answers `200` with `{ course }`, now showing `status.code: "draft"`, and files a `course_unarchived` row.

## POST /api/v1/courses/:id/demo-bookings

Opens or closes this course to trial calls from students who have not taken a place. The body requires `{ enabled: boolean }`. Setting it to the value it already holds succeeds and writes nothing — a portal whose response was lost on the way home can press the same switch again without filing a second record.

There is no status gate: the booking system already refuses demo requests on unpublished courses, so a flag set on a draft is a decision waiting for the course to go live. Success answers `200` with `{ course }`, reflecting the updated `demoBookingsEnabled`.

## GET /api/v1/courses/:courseId/modules

Lists the active modules of one of the calling teacher's courses, in their current order. The `:courseId` is resolved against this session's courses, so another teacher's course answers `404`. Success answers `200` with `{ items: CourseModule[] }`, each with a `position` assigned by the API.

Deactivated modules are excluded. A course with no modules returns an empty array.

## POST /api/v1/courses/:courseId/modules

Adds a new module to the end of the course's syllabus. The body requires `title` (3–120 characters), plus optional `summary` and `description`. The `position` is assigned automatically — there is no way to name a slot, because a client allowed to do so could put two modules in one position.

Success answers `201` with `{ module }`, including the assigned `position`.

## PATCH /api/v1/courses/:courseId/modules/:id

Updates one module's prose: `title`, `summary` or `description`. A body that sends every field back unchanged writes nothing and returns the module as-is, with its `updatedAt` untouched. A module id not belonging to this course answers `404`.

Success answers `200` with `{ module }`.

## POST /api/v1/courses/:courseId/modules/reorder

Reorders all active modules of the course. The body requires `{ moduleIds: string[] }`, which must be a permutation of every active module id exactly once. An id not held by an active module, a duplicate, or a missing module answers `400` with `VALIDATION_FAILED` and `details.validation.moduleIds`: `Send every module of the course once, in the order you want them.`

An order identical to the current one moves nothing and writes nothing. Success answers `200` with `{ items: CourseModule[] }`, reflecting the new positions.

## POST /api/v1/courses/:courseId/modules/:id/deactivate

Takes a module out of the syllabus. If the course is `published` and the module holds any published lessons, the call answers `409` with `CONFLICT` and `This block still holds a page a student can read. Take those lessons back to a draft first.` An empty module, or one whose every page is still a draft, can be deactivated freely — refusing that would strand a block added by mistake under a live course.

The row keeps its slot number, so nothing later inherits the position a student may have read. Success answers `200` with `{ module }`.

## GET /api/v1/modules/:moduleId/lessons

Lists the active lessons of one module, in their current order. The `:moduleId` is resolved against the courses this session owns, so another teacher's module answers `404`. Success answers `200` with `{ items: Lesson[] }`, each with a `position` and a `status` (`draft` or `published`).

Deactivated lessons are excluded. A module with no lessons returns an empty array.

## POST /api/v1/modules/:moduleId/lessons

Adds a new lesson to the end of the module. The body requires `title` (3–120 characters), plus optional `body` (up to 20,000 characters) and `estimatedMinutes` (1–600). The lesson starts as `draft` with `isFreePreview: false`. The `position` is assigned automatically.

Success answers `201` with `{ lesson }`.

## PATCH /api/v1/modules/:moduleId/lessons/:id

Updates one lesson. The body may contain any subset of `title`, `body`, `estimatedMinutes`, `isFreePreview` and `moduleId`. Sending a different `moduleId` moves the lesson to the end of that module's order — the position it held is not kept for it, because a moved lesson has gone and the block it left has nothing pointing at it.

A body that changes nothing writes nothing and returns the lesson as-is. Success answers `200` with `{ lesson }`.

## POST /api/v1/modules/:moduleId/lessons/reorder

Reorders all active lessons of the module. The body requires `{ lessonIds: string[] }`, which must be a permutation of every active lesson id exactly once. An id not held by an active lesson of this module, a duplicate, or a missing lesson answers `400` with `VALIDATION_FAILED` and `details.validation.lessonIds`: `Send every lesson of the module once, in the order you want them.`

An order identical to the current one moves nothing and writes nothing. Success answers `200` with `{ items: Lesson[] }`, reflecting the new positions.

## POST /api/v1/modules/:moduleId/lessons/:id/publish

Moves a draft lesson to `published`. The lesson must currently be `draft`; a published or deactivated lesson answers `409` with `CONFLICT` and `Only a draft lesson can be published.` The lesson must also have `body` filled in — an empty page answers `400` with `VALIDATION_FAILED` and `details.validation.body`: `Write the page before publishing it.`

Publishing is the only way a page reaches a student, but it is not sufficient on its own: the catalog reads two gates, and a published lesson under a draft course is still invisible. Success answers `200` with `{ lesson }`, now showing `status.code: "published"`.

## POST /api/v1/modules/:moduleId/lessons/:id/unpublish

Moves a published lesson back to `draft`. The lesson must currently be `published`; a draft or deactivated lesson answers `409` with `CONFLICT` and `Only a published lesson can go back to a draft.`

Unpublishing is allowed even on a live course, because taking a page out of what a student is reading by putting it back into the author's hands is reversible in a way deactivation is not. Success answers `200` with `{ lesson }`, now showing `status.code: "draft"`.

## POST /api/v1/modules/:moduleId/lessons/:id/deactivate

Removes a lesson from the syllabus entirely. If the lesson is `published` and its course is also `published` — meaning a student can currently read it — the call answers `409` with `CONFLICT` and `A page a student can read goes back to a draft first — unpublish it, then take it out of the syllabus.` Either gate closed means nobody is reading it, and a teacher tidying away a page no student has ever been shown is not taking anything from anybody.

Success answers `200` with `{ lesson }`.

## GET /api/v1/modules/:moduleId/lessons/:lessonId/asset

Returns the standing recording attached to a lesson, or `null` if none has been uploaded. Success answers `200` with `{ asset: LessonAsset | null }`. The response deliberately omits `storedKey` — the store's address for the bytes — because a client that knew it would be looking for a URL to fetch it from, and this design has none. Every read of a recording goes through [the video route](/docs/api-courses#get-modules-moduleid-lessons-lessonid-asset-video).

## POST /api/v1/modules/:moduleId/lessons/:lessonId/asset

Uploads a video recording to a lesson. The request body is a multipart stream, parsed server-side — there is no JSON body to validate. The upload is checked against `MAX_UPLOAD_MB`, and the lesson must be active (not deactivated) or the call answers `404`.

Every upload creates a new row; the recording it retires stays on the page's record rather than being overwritten. Success answers `201` with `{ asset }`, reflecting the newly standing recording.

## GET /api/v1/modules/:moduleId/lessons/:lessonId/asset/video

Streams the lesson's recording back to the teacher who uploaded it. The response is a byte stream with ranged-read support, so a client can seek within the video. If no recording is attached, the call answers `404` with `NOT_FOUND`.

This route lives on this address and not a public one because the key these bytes live under is the store's business — a URL for a paid recording is exactly what this module was built not to have.

## GET /api/v1/courses/:courseId/roster

Lists the students who hold a place in one of the calling teacher's courses. Optional query parameters `page` and `pageSize` paginate the results (default page size is reasonable for a class list). Success answers `200` with `{ items: CourseRosterEntry[], page, pageSize, total }`, where `total` counts every [[open place]] in the course, not just the ones on this page.

Each entry shows the student's `id` and `fullName`, plus `enrolledAt` (the day the place was first taken, which is not the day a student who left came back). There is no email address — a [[roster]] answers "who is coming to class", and an address is the field a list like this gains by convenience and never drops. There is also no enrollment id: leaving is the student's decision, so giving the [[roster]] a primary key would be an invitation to build the route that removes somebody's place for them.

## GET /api/v1/courses/:courseId/series

Lists recurring weekly class series scheduled for a course. Each [[series]] defines a recurring weekly slot (weekday, startMinutes, endMinutes, durationMinutes) that generates regular class sessions.

## POST /api/v1/courses/:courseId/series

Creates a new recurring weekly class series for the specified course.

Three rules decide whether the write is accepted, and all three refuse with `409`. The window has to close after it opens, the class has to fit inside the window, and no class this teacher already stands for may cover any minute of it. The third is asked across every course the account runs, because the thing that has to be in both rooms is the teacher rather than the course: Monday 09:00–10:00 on Algebra and Monday 10:00–11:00 on Verbs is a timetable, and Monday 09:30 on either is one person booked into two places. Two classes that meet at the edge are not a collision — the overlap is refused, the touch is not — and the refusal names the day, the span and the course that already holds it. Two teachers at the same minute on the same weekday is a normal Tuesday in a marketplace, so that is never a clash.

## PATCH /api/v1/courses/:courseId/series/:id

Updates an existing class series schedule for the course.

The same three rules apply to the window the edit would produce, with the row being edited left out of the search — otherwise a teacher could never press Save on a class they had not moved. A series that has been retired and is written again at the same opening minute on the same course is that row brought back rather than a second one beside it, because a course holds one plan per day and minute for as long as it exists.

## POST /api/v1/courses/:courseId/series/:id/retire

Retires a class series so it stops generating future class slots.

## GET /api/v1/courses/:courseId/coupons

Lists all discount coupons created by the teacher for this course.

## POST /api/v1/courses/:courseId/coupons

Creates a new discount coupon for this course with amount, type (percentage or fixed), and optional expiration or redemption limits.

## GET /api/v1/courses/:courseId/coupons/:id

Gets details of a specific coupon by its identifier.

## PATCH /api/v1/courses/:courseId/coupons/:id

Updates coupon parameters such as expiration date or max redemption limits.

## POST /api/v1/courses/:courseId/coupons/:id/deactivate

Deactivates a coupon so it can no longer be redeemed for new enrollments.
