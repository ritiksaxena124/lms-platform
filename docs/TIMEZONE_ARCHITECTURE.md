# Timezone Architecture

Hourloom handles timezones correctly for a global, mobile user base. This document explains how.

## The Golden Rule

> **Store in UTC, display in local time.**

Every timestamp in the database is stored in UTC. When shown to users, it's converted to their browser's current timezone — not their account's saved timezone.

## Why Browser Timezone, Not Account Timezone?

Consider a teacher who:
1. Creates their account in Mumbai (timezone: `Asia/Kolkata`, UTC+5:30)
2. Schedules a class for 9:00 AM IST
3. Flies to New York for a conference
4. Opens their calendar there

**With account timezone:** They see "9:00 AM" but it's actually 11:30 PM the previous day in New York. They miss the class.

**With browser timezone:** They see "11:30 PM (previous day)" and understand when to show up.

The account's saved timezone is still useful for:
- Default timezone when creating new availability windows
- Suggested times when booking classes
- Understanding what timezone the teacher originally set up their schedule in

But the clock on screen must always match where the person reading it stands.

## How It Works

### 1. Database Layer (PostgreSQL)

All timestamps use `Timestamptz(6)` which stores in UTC:

```prisma
startsAt DateTime @map("starts_at") @db.Timestamptz(6)
endsAt   DateTime @map("ends_at") @db.Timestamptz(6)
```

### 2. API Layer (NestJS)

Returns ISO 8601 strings with `Z` suffix (UTC):

```typescript
startsAt: row.startsAt.toISOString()
// Returns: "2024-10-15T03:30:00.000Z" (the Z means UTC)
```

### 3. Frontend Layer (Next.js)

Uses `Intl.DateTimeFormat` to convert UTC to browser's local timezone:

```typescript
// apps/teacher/lib/dates.ts
export function readerZone(_timeZone?: string | null): string {
  // Always use browser's current timezone
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatClassWindow(startsAt: string, endsAt: string, timeZone?: string | null): string {
  const zone = readerZone(timeZone);
  // Converts "2024-10-15T03:30:00.000Z" → "Tue 15 Oct, 09:00–09:45" (in IST)
  // or "Mon 14 Oct, 23:30–00:15" (in EST)
  return `${namedDay(startsAt, zone)}, ${clockFace(startsAt, zone)}–${clockFace(endsAt, zone)}`;
}
```

### 4. User Registration

Captures browser's timezone at signup as a preference:

```typescript
// apps/teacher/components/sign-up-form.tsx
await signUp({
  fullName,
  email,
  password,
  role: 'teacher',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // e.g., "Asia/Kolkata"
});
```

This is stored in the User model but only used for defaults, not display.

## Testing Timezone Handling

### Test 1: Same Instant, Different Displays

A class scheduled for `2024-10-15T03:30:00.000Z` (UTC):

| Location | Browser Timezone | Display |
|----------|------------------|---------|
| Mumbai | Asia/Kolkata (UTC+5:30) | Tue 15 Oct, 09:00–09:45 |
| New York | America/New_York (UTC-4) | Mon 14 Oct, 23:30–00:15 |
| London | Europe/London (UTC+1) | Tue 15 Oct, 04:30–05:15 |

Same instant, three different displays, all correct.

### Test 2: Traveler Scenario

1. Teacher in India creates account → `timezone: 'Asia/Kolkata'` saved
2. Teacher schedules class for 9:00 AM IST → stored as `03:30:00Z` in DB
3. Teacher travels to US, opens calendar
4. Browser detects `America/New_York` timezone
5. Class shows as "11:30 PM (previous day)" ✅ Correct!

## Common Mistakes to Avoid

### ❌ Don't store timezone offsets

```typescript
// BAD - breaks during DST changes
const offset = "+05:30";
```

### ✅ Do store IANA timezone names

```typescript
// GOOD - handles DST automatically
const timezone = "Asia/Kolkata";
```

### ❌ Don't use account timezone for display

```typescript
// BAD - traveler sees wrong times
const zone = user.timezone ?? 'UTC';
```

### ✅ Do use browser timezone for display

```typescript
// GOOD - always shows correct local time
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
```

### ❌ Don't manually calculate timezone conversions

```typescript
// BAD - reinventing the wheel, misses DST rules
const localTime = utcTime + 5.5 * 60 * 60 * 1000;
```

### ✅ Do use Intl.DateTimeFormat

```typescript
// GOOD - uses browser's timezone database, handles DST
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
});
```

## Daylight Saving Time

IANA timezone names (`America/New_York`, `Europe/London`) include DST rules. The browser's `Intl.DateTimeFormat` automatically applies them:

```typescript
// Summer in New York (EDT, UTC-4)
formatClassWindow("2024-07-15T13:00:00.000Z", ...)
// → "Mon 15 Jul, 09:00–09:45"

// Winter in New York (EST, UTC-5)
formatClassWindow("2024-12-15T14:00:00.000Z", ...)
// → "Sun 15 Dec, 09:00–09:45"
```

No manual calculation needed.

## Files Involved

- **Database schema**: `apps/api/prisma/schema.prisma` (all `@db.Timestamptz(6)` fields)
- **API serialization**: Various service files calling `.toISOString()`
- **Teacher formatting**: `apps/teacher/lib/dates.ts`
- **Student formatting**: `apps/student/lib/dates.ts`
- **User registration**: `apps/*/components/sign-up-form.tsx` (captures browser timezone)
- **Seed data**: `apps/api/src/reference/seed-demo-accounts.ts` (sets demo accounts to IST)

## Future Considerations

If we want to add a "show times in [timezone]" preference (for teachers managing students in other zones), we could:

1. Add a `displayTimezone` field to User model
2. Let users override it in settings
3. Pass it to `formatClassWindow(startsAt, endsAt, user.displayTimezone)`
4. But default to browser timezone for new users

The key is making it an explicit choice, not assuming the account's creation timezone is always right.
