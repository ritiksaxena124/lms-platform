# Platform and infrastructure API

These endpoints expose operational data about the system itself — health status, the action log operators rely on, and the outbox queue that drives reliable event delivery. They are not part of any user-facing workflow; instead they support monitoring, auditing, and debugging.

## GET /api/v1/health

Returns a 200 status when the API is running. This endpoint requires no authentication and carries no payload beyond the standard response envelope. Load balancers and orchestration systems use it to determine whether the instance should receive traffic.

The health check does not probe the database or external services; it confirms only that the HTTP server is alive and accepting requests.

## GET /api/v1/actions

Queries the action log — an append-only record of every significant event in the system. Each entry captures who did what, to which entity, and when. Operators use this screen to audit account changes, trace course authoring history, and investigate booking failures.

Query parameters filter by section (account, teacher_profile, course_authoring, lesson_media, availability, enrollment, booking), specific action type, actor ID, or target ID. Results are returned in reverse chronological order with pagination support.

Only ops staff may call this route. The response includes the full action vocabulary — from `account_registered` through `booking_expired` — along with timestamps and the identity of the actor who triggered each event.

## GET /api/v1/outbox

Lists messages waiting in the outbox for delivery. The outbox pattern ensures that events are reliably sent even if the mail service is temporarily unavailable. Each record represents an email or notification that has not yet reached its recipient.

The response shows the message status (`pending`, `sent`, `failed`), retry count, and last error if delivery failed. Ops staff use this screen to monitor delivery health and identify stuck messages.

This endpoint is read-only; the delivery sweep runs automatically on a cron schedule and claims messages atomically to prevent duplicate sends.
