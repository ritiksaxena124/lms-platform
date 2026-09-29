# The API reference

One API under `/api/v1`, JSON in and JSON out, and no version of it but the one that is deployed.
The route table at the bottom of this page is not written by hand: a command boots the module graph
Nest itself walks and reads each route's method, path, success status and access rule off the
decorators that decide them, so a new controller shows up here whether anybody remembered or not.

```endpoints
```

Regenerate it with `bun run --filter @lms/api docs:export`. A test compares the committed file
against the application on every gate, so a renamed route or a new `@Roles` turns the build red
rather than leaving this page politely wrong.

## Getting a session

`POST /api/v1/auth/register` and `POST /api/v1/auth/login` are the two doors in. Both answer with the
account and a bearer access token that lives fifteen minutes:

```json
{
  "user": { "id": "…", "email": "…", "role": "teacher", "timezone": "Asia/Kolkata" },
  "accessToken": "…",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

The refresh token is not in that body, and that is the design rather than an omission. It travels
only as an `HttpOnly` cookie named `lms_refresh`, so nothing in a portal can put it somewhere
JavaScript can reach. Every other request carries the access token as
`Authorization: Bearer <accessToken>`; when it expires, `POST /api/v1/auth/refresh` — which
authenticates from the cookie, because by then there is no access token left to present — rotates the
refresh token and hands back a new pair.

`GET /api/v1/auth/me` is the check a portal makes on load. It answers with the account as the API
currently understands it, which is the same read the guards use: a role change or a deactivation takes
effect on the next request, not when a token happens to die.

## What an answer looks like

Every route wraps its own payload in a named object — `{ "course": … }`, `{ "items": […], "page": 1,
"pageSize": 20, "total": 7 }` — so a client is never guessing what shape a bare body has. The lists
that can grow carry `page`, `pageSize` and `total`; the ones that cannot — a week of availability, the
modules of one course — answer with `items` alone, and a pagination control that never appears on a
list nobody can grow past a screen is one fewer thing to maintain wrongly.

Failures have [one shape](/docs/conventions#every-failure-has-one-shape): a status, a code out of a
closed list, a sentence for the human who has to read it, and the `requestId` that ties the answer to
the log line. A validation failure adds `details.validation` keyed by field, which is how a form knows
which input to turn red — the request body's unknown properties are rejected rather than dropped, so a
client that sends a field the route does not read hears about it on the first call instead of wondering
why nothing changed.

## Limits

`120` requests a minute per client everywhere, and `20` on the two credential routes, which answer
`429` with code `RATE_LIMITED`. The tighter budget is on password guessing rather than on anybody's
browsing, so it is attached to register and login and to nothing else.

Two routes are worth knowing before you call them:

- The class room, `POST /api/v1/bookings/:id/room`, answers `Cache-Control: no-store`. A room name is
  minted for a particular caller at a particular minute, and a cached copy of it is a door left open
  in a browser's memory.
- The two video routes — the teacher's own `…/asset/video` and the catalog's `…/lessons/:lessonId/video`
  — honour a `Range` header, which is what lets a learner seek into a recording. A satisfiable range
  gets `206` with `Content-Range`; an unparseable one is treated as no range at all and gets the whole
  file with `200`, and only a range that cannot be met gets `416`. Those are different mistakes and the
  player cannot tell them apart afterwards.

## Reading the table

The **Who may call** column is the guard's own decision, in three kinds:

| Written as         | What happens on the wire                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| `anyone`           | The session header is ignored. A stranger and a signed-in account get the same answer. |
| `anyone, session read if offered` | The route answers without a session, and resolves one if it is brought. This is how a single catalog page serves both a stranger reading a free page and a learner whose enrollment opens the rest of the course. |
| `teacher`, `student`, `ops`, or `any signed-in account` | A session is required, and the role has to match if the route names one. |

A role written on a controller covers every route under it, which is why all four `users` rows say
`ops` even though only one of them declares it. A role written on a handler covers that route alone —
`bookings` is where a teacher and a student meet the same table from opposite sides, so its roles
belong to the handler — and the one route there that names none is the exception on purpose: the room
belongs to whichever side of the class is standing at the door.
