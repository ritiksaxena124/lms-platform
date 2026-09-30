# Signing in, accounts and the teacher's profile

Eleven routes, in the order a person meets them: the four that get a session and keep it alive, the
two that say who the session belongs to, the one a teacher fills in about themselves, and the four
that an operator uses to keep the register of accounts honest.

Under each heading is the contract the code holds for that route — who gets past the guard, what the
body has to look like, what a success answers with, and which class serves it. That part is not
typed out here: a command reads it off the decorators and the shared types on every gate, so a field
renamed in the API is renamed on this page in the same commit. What is written here is the half a
machine cannot supply — what the route is for, and what it does when the answer is no.

## POST /api/v1/auth/register

The door a new person walks through, and the only one that creates an account. It answers with the
account, not with a session: a portal that wants to sign the person in on the spot calls
[login](/docs/api-auth#post-auth-login) with the same credentials afterwards, so the one route that
issues tokens is the one that proves a password.

Two rules shape what a caller may send. The `role` is `student` or `teacher` — the `ops` role is not
self-serviceable at any price, and is granted only through [the operator's role
route](/docs/api-auth#patch-users-id-role). And a password is twelve characters minimum, which is a
floor set for the hashing budget rather than for a person's memory: this route sits behind the
tighter rate limit, so the cost of a guess is meant to be high on both sides.

A second account on an address that already has one answers `409` with code `EMAIL_ALREADY_TAKEN`
and `details.validation.email`, which is the shape a form needs: the sentence lands keyed on the field
that was wrong rather than in a banner above the whole page. An address that differs only by capital
letters or surrounding space is the same address — the column is compared after the value is trimmed
and folded.

## POST /api/v1/auth/login

Checks the password and opens a session. A successful call answers with the access token and the
account, and sets the refresh token as an `HttpOnly` cookie named `lms_refresh` — the token a portal
can use is in the body, the token that mints more of them is deliberately not.

The failures are worth reading before writing a login form, because two of them are the same answer:

- No account with that address, and an account with a different password, both answer `401` with
  code `INVALID_CREDENTIALS` and the sentence `Email or password is incorrect.` The route also does
  the same amount of work in both cases — a missing user is still run through a password check — so
  the response time does not list which addresses the platform holds.
- An account that exists and is switched off answers `403` with `ACCOUNT_DISABLED`. That is a
  different message on purpose: somebody whose account went dark needs to be told to contact support,
  not to keep trying.

Every sign-in that succeeds is written to the activity log, with the user agent string that asked.
A failed password is not, and neither is a failed status check — the log records the sign-in that
happened, not the attempts that did not.

## POST /api/v1/auth/refresh

How a fifteen-minute access token outlives a working day. The route is marked public because the
access token it replaces has usually already expired by the time it is called, so it authenticates
from the `lms_refresh` cookie and needs no header at all. That is why a portal's session code calls
it before it attaches any authorization.

The token it reads is rotated: the presented one is retired and a new pair is issued, so a refresh
token is single-use. Two failures follow from that:

- No cookie, or a cookie this platform did not issue, is `401` with `TOKEN_INVALID`.
- A token that was already retired is also `401` with `TOKEN_INVALID` — but it costs more than the
  call. A retired token being replayed means something has a copy of it, and nothing here can know
  what else that copy has read, so every session the account holds is ended at once and the event is
  written to the log as `session.replay_detected` with the number of sessions it closed. A user whose
  devices all dropped out at the same minute was signed in on one of them twice.
- A token that simply aged past its own expiry is `401` with `TOKEN_EXPIRED`, and the portal's job is
  to show the sign-in screen rather than retry.

An account that has been disabled since it signed in is refused with `403 ACCOUNT_DISABLED` here too,
which is the second of the two places a switch-off takes effect immediately rather than when a token
happens to die.

## GET /api/v1/auth/me

The check a portal makes when it loads. Any signed-in account, any role.

The point of it is that the answer is read from the row, not decoded from the token. A valid token is
only a claim that somebody signed in once; this route answers who they are now, which is what makes a
role change or a deactivation take effect on the next request rather than at the token's expiry. It is
also why a portal that has cached a role from its last login is caching the wrong thing.

A token that no longer maps to an account — one for a row that has gone, or a signature this
deployment did not make — is `401` with `TOKEN_INVALID`, and the portal should treat it as signed out.

## POST /api/v1/auth/logout

Ends the session held in the cookie and clears it. It asks for nothing and answers `204` with no
body, whatever the state of the caller.

That includes a caller with no cookie and a cookie that was already retired: signing out of a session
that is not open is still signed out, so a portal can fire this on every "Sign out" press and never
have to know whether it won. The activity log sees it the same way — the record is filed by the write
that actually ended a live session, so a user who double-clicks the button appears in the ledger once.

## GET /api/v1/teacher/profile

The teacher's own words about their teaching: headline, bio, subjects, rate and the zone they work in.
Teachers only — the guard answers `403 FORBIDDEN` for a student or an operator holding a valid token,
because that is a caller the platform knows and does not allow, which is a different fact from
`401`.

The answer is `profile: null` when this teacher has never saved one. That is the ordinary state, not
an error: an account becomes a teacher the moment it registers, and the profile is what they say
about it afterwards. A form has to be able to open on nothing.

## PUT /api/v1/teacher/profile

Replaces the whole document. A subject removed in the form arrives as a subject that is simply not in
the list, so there is no second route to delete one and no way for a partially-filled form to mean
something it did not say.

Three things a caller should know before the first attempt:

- `subjects` are codes from the platform's subject list, not free text. A code that is not on the list
  answers `400` with `details.validation.subjects` naming each unknown one, because the list is
  editable by operators and a form that offers a stale value needs to be told, not forgiven.
- `hourlyRateMinorUnits` and `currency` are one decision. Either may be left out; bringing one means
  bringing both, and the missing half is reported against the field that was not sent, which is where
  a form can highlight it. The amount is in the currency's minor units — `499900` is ₹4,999.00 — so
  the client that typed a rupee figure and the row that stores it never meet in a float.
- `timezone` is an IANA zone like `Asia/Kolkata`, and it is written onto the **account**, not the
  profile. It governs when a class starts and when a reminder goes out, so a copy of it on the profile
  table would be a second truth to keep in step.

Posting the form back exactly as it loaded changes nothing, and the route says so honestly: no row is
written, no activity is logged, and `updatedAt` stays where it was. The first save creates the
document, so the same call answers `null` on one page load and a full profile on the next.

## GET /api/v1/users

The operator's register of accounts, newest first. `ops` only, on every route under this controller.

Four filters, all optional: `q` searches the name and the address (two characters minimum, so a
half-typed word does not return the whole table), `role` and `status` take the closed sets the
platform defines, and `page` with `pageSize` walk the result. `pageSize` is capped at `100`, and
`total` counts everything the filters matched rather than the rows on this page — that is what lets a
screen say "412 accounts, these 25" and let the person decide whether the search was too broad.

This is the one read in the system that may name a person by their email address, and the permission
is the reason: an operator looking for an account is looking for the address somebody gave them. The
activity log made the opposite choice for its own rows, because a log line outlives the correction a
person makes to their address.

## GET /api/v1/users/:id

One account, with the counts an operator decides with: how many courses they teach, how many places
they hold, how many classes. An id that is not one — badly formed, or absent — answers `404` with
`No account with that id`, and the route does not distinguish the two. To the person at the screen
they are the same question, and telling them apart would be telling them which ids exist.

## PATCH /api/v1/users/:id/role

Issues or revokes the `ops` role, which is the only role move this route makes.

Both halves are guarded against the obvious accident: an operator cannot change their own role, which
answers `403` — a person who could demote themselves could also promote themselves, and the platform
is not going to be one CSRF token away from having no operators at all. Setting a role an account
already has answers `409`.

A student becoming a teacher is refused as a conflict with `Only the ops role is issued or revoked
here`. That is a decision rather than a limitation: an account either registered itself or was given
the ops role, and those are the two transitions anyone has built a moderation flow for. Refusing the
third keeps this route to the promise it was scoped with; the day a flow exists, the check is the
thing that comes out.

A role change is read on the next request, not on the token's expiry — [auth/me](/docs/api-auth#get-auth-me)
and the guard both ask the row — so the account's own portals change what they show as soon as they
fetch again.

## PATCH /api/v1/users/:id/status

Turns an account off, or back on. Not your own account, which answers `403`, and not a status it
already holds, which answers `409`.

Disabling is the whole kill switch: the guard asks the account on every authenticated request, so a
switched-off account is refused inside one request of being switched off, and the same is true of the
refresh route. What it does **not** do is delete the sessions the account holds. The row's status is
the answer to "may this account in", so there is nothing for a second mechanism to say — and an
account that comes back online has not lost sessions it never needed to lose.

Both writes are recorded with the operator who made them and the status the account moved from and to,
which is what turns "this person could not sign in on Tuesday" into a lookup rather than an
investigation.
