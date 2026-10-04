# Hourloom Building Playbook

**Complete memory, techniques, skills, and system prompts used to build Hourloom (v0.13.0)**

This document distills everything learned across 13 phases of building a production-grade multi-portal LMS platform. Use it as a reusable skill set for future projects.

---

## Table of Contents

1. [Development Process](#development-process)
2. [Data Modeling Principles](#data-modeling-principles)
3. [Frontend Design System](#frontend-design-system)
4. [Architecture Decisions](#architecture-decisions)
5. [Testing Strategy](#testing-strategy)
6. [Verification & Debugging Techniques](#verification--debugging-techniques)
7. [Tool Artifacts & Pitfalls](#tool-artifacts--pitfalls)
8. [Environment Setup](#environment-setup)
9. [Phase Gating Protocol](#phase-gating-protocol)
10. [System Prompts That Worked](#system-prompts-that-worked)
11. [Skills Used](#skills-used)
12. [Release Protocol](#release-protocol)

---

## Development Process

### Core Principle: Test-Driven, Phase-Gated, Incremental

**Rule:** Write the failing test first, show the failing output, then implement the minimum. Never write implementation before the test for business logic.

**Why:** The user is building production-minded software incrementally and treats a plan-and-review cadence as the deliverable, not bulk code generation. Unreviewed or test-less code is considered not done.

**How to apply:**
1. Default to: planning → approval → one phase → verification → report → stop
2. Do NOT start a new module until the current one is genuinely complete:
   - Tests green
   - Backend done
   - UI done with all states (loading, empty, error, success)
   - Browser verified (golden path + refusals clicked through)
   - Reviewed and committed
3. Use installed skills instead of hand-rolling equivalents
4. Say explicitly when a skill should have been used or when a test could not be written

### One Feature at a Time

Never start the next feature until the current one is fully complete. A feature is "done" only when:
- All tests pass
- Backend API is complete and tested
- Portal screen covers loading/empty/error/success states
- Browser verification completed (golden path AND refusal paths)
- Code reviewed
- Committed with conventional commit message

### Plan Before Code

Present the plan plus 2–3 scoping questions on genuinely load-bearing choices before writing code. The user answers concretely, then says go. Do not ask about things the codebase already decides.

When handed a new capability for a later phase, **update the phase plan in the docs first and commit that on its own**, before designing or coding anything.

---

## Data Modeling Principles

### Soft Delete Everywhere

**Rule:** No hard deletes in the database. All business rows are deactivated with an `isActive` flag instead of being removed. No `onDelete: Cascade` relations and no Prisma `delete*` calls in repositories.

**Schema pattern:**
```prisma
model Course {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  isActive  Boolean  @default(true)
  
  // Business fields...
}
```

**Why:** Data stays recoverable and audit trails hold. The user explicitly ruled out physical deletion.

**How to apply:**
- Give every major table: `id`, `createdAt`, `updatedAt`, `isActive`
- Keep identity keys (email, slug, provider payment ID) globally unique regardless of `isActive`
- Scope mutable business keys with partial unique indexes (`WHERE is_active`)
- Append-only ledger/event rows (payment transactions, webhook events, attendance, status history, audit log) are **never deleted** and **never flagged** — agree on that exception before adding a meaningless `isActive`
- Default all reads to active rows with an explicit opt-in to include archived

### Identity vs Business Key Separation

Identity keys (email, slug) must remain globally unique even after deactivation. Use partial unique indexes:

```prisma
@@unique([email], map: "uq_user_email", where: "is_active")
```

This allows re-registration with the same email after account deactivation while preventing duplicate active accounts.

### Lookup Tables Over Enums

Use database lookup tables (`LkpType`/`LkpValue`) rather than enums so operators can add values without migrations. Exception: codes that require code changes to honor (like mail outbox statuses) live in `@lms/shared` constants.

---

## Frontend Design System

### Typeface: Inter Only

**Rule:** One typeface: Inter. Do not reach for a display face to create hierarchy — use size, weight and colour.

**Why:** The user overrode an earlier serif/mono pairing with "Use Inter as font everywhere". Consistency trumps variety.

### Qoder IDE Look

**Aim for:** "clean and crisp". Borders and neutral surfaces do the structural work; colour only ever means something.

**Specifics:**
- No shadows unless required (only for floating layers: menu, dialog, toast)
- Flat layout gets a hairline border
- Gradients only when they earn a place — proper ones, tied to a named job, not decoration
- Illustrations from openpeeps.com and storyset.com/people welcome where they genuinely improve a screen (empty states, first-run panels), not on every page
- Storyset figures must be **recoloured to the app's own tokens** before they ship

### Toasts: react-hot-toast

**Rule:** Toasts use **react-hot-toast**, never the `sonner` preset shipped by shadcn.

### Layout: Full Viewport, Not Centered Column

Portal shells fill the viewport; they are not a centred column. The sidebar touches the left edge of the browser and the app takes the complete width. Do not reintroduce a `max-w-*` wrapper around a whole portal frame — cap the content inside the scrolling column instead.

### Form Controls Stay Native

Style what the browser gives, do not replace it. Example: checkbox built as a real `<input>` tinted with `accent-color` over a drawn box, because a box that only looks like a checkbox behaves like one to nobody — keyboard, screen reader, the platform's own tick.

### State Wording Names the Decision Still Pending

A page marked free but unpublished reads "Free when published" rather than "Free", so a control never implies an outcome the user has not actually unlocked.

### Font Quality Judged on Rendered Pixels

When the user asks for type that is "top notch, crisp and clear", check three things:
1. The loaded font file exposes the axes the CSS requests
2. Text is not stranded on a permanent composited layer
3. Every text token clears WCAG AA at the small size it is used at

Measure in the browser and lock the result in a test.

### Shared Component Library Previewed in Storybook

Every operation surfaces proper states: loading, empty, error, success. Page transitions should be smooth, matching polished SaaS products. A shared component library is **previewed and maintained in Storybook**, because other developers will maintain it. A component without a story is undocumented.

A new kit primitive ships **with its first consuming screen, in the same reviewed chunk** — primitive + tests + story + the wired usage — rather than as a standalone export nobody has used yet.

---

## Architecture Decisions

### Portals Are Separate Next Apps Sharing a Component Library

**Decision:** Teacher, student, and ops portals are separate Next.js apps sharing `@lms/ui` and `@lms/shared`.

**Why:** User's explicit preference over one path-based app. Consequence: cross-app session sharing had to be designed, and new apps are scaffolded only when their phase begins.

### Wildcard Dev Domains for Session Sharing

Sessions use wildcard dev domains:
- `teacher.localtest.me:3000`
- `student.localtest.me:3001`
- `ops.localtest.me:3002`
- `api.localtest.me:4000`

One refresh cookie on `Domain=localtest.me`, so one login works across portals.

### Least-Privilege DB Role

Use a least-privilege database role rather than the superuser. See environment setup for Postgres details.

### Public Catalog Routes Are Read-Only and Sessionless

Public catalog routes are read-only and sessionless. A free lesson is served by its own endpoint rather than carried in the outline payload so a stranger can't fetch every body with the list. Courses are addressable by slug or ID.

### Provider Ports Pattern

External services (mail, storage, video) sit behind provider ports:
- `apps/api/src/providers/mail` (SMTP adapter + none adapter)
- `apps/api/src/providers/storage` (local adapter + selection)
- Video port resolved via `VIDEO_PROVIDER` env var

Each port has:
- Interface defining the contract
- Adapters implementing it (real + none)
- Module selection based on env var presence
- No vendor SDK in the main build if ESM-only

### One API, Three Portals, Nothing Ever Destroyed

Single NestJS modular monolith answering under `/api/v1`. Three portals (teacher, student, ops) share one API, one database, one component library. UTC in storage, reader's zone on screen. One envelope for every failure.

---

## Testing Strategy

### Vitest Only, Never Bare `bun test`

**Rule:** Every package's `test` script is `vitest run`. Never run bare `bun test` — Bun's own `expect` is not compatible with these specs.

**Why:** Bun's expect writes `expect.any(...)` matchers back into objects checked by `toMatchObject` (fields turn into `Any<Number>`, so later arithmetic and `new Date(...)` go NaN) and refuses thenables — every `await expect(prismaCall).rejects` fails.

### Root Test Is Sequential Chain

Root `bun run test` is a sequential `&&` chain, not parallel:
```bash
bun run --filter @lms/shared test && \
bun run --filter @lms/ui test && \
bun run --filter @lms/api test && \
bun run --filter @lms/student test && \
bun run --filter @lms/teacher test && \
bun run --filter @lms/ops test && \
bun run --filter @lms/site test
```

A new workspace joins `typecheck` and `lint` automatically but must be appended to `test` by hand.

### Connection Pool Management

A full API suite can exhaust Postgres's 100 connections. Each spec file boots its own `AppModule` *and* opens its own `PrismaClient` for assertions. Pin forks:

```typescript
// vitest.config.ts
pool: 'forks',
maxWorkers: 4,
```

### Sweep Assertions Scope to Created Rows

A sweep's returned tally is a whole-table number. Multiple spec files call the same sweep against one test database, so `expect(swept).toBeGreaterThanOrEqual(2)` is another fork's work subtracted from yours. Assert on the rows the file created (status + timestamp), which is the same fact and addressable.

### React-Hot-Toast Store Is Module Singleton

RTL's `cleanup` only unmounts DOM, so every test mounting a Toaster also renders all previous tests' toasts. Fix:

```typescript
beforeEach(() => toast.remove());
```

### UserEvent Delay Null for Performance

`userEvent.type` waits a macrotask per character, so a spec filling three fields with 39 characters costs seconds. Fix:

```typescript
const user = userEvent.setup({ delay: null });
```

### HookTimeout vs TestTimeout

`hookTimeout` is the honest knob for slow application boot; `testTimeout` is not. Each API spec's `beforeAll` builds the whole app (fifteen controllers, providers, Prisma client, crons). Set:

```typescript
hookTimeout: 60000  // 60s for boot
testTimeout: 15000  // 15s for assertions
```

### Cold Database Race Condition

CI starts from an EMPTY test database on every push. Multiple spec files seeding reference lookups race on cold start. Fix: make seed operations atomic or serialize them. Local box is always warm, so this is invisible locally.

---

## Verification & Debugging Techniques

### Verify Before Repairing

**Rule:** Treat a tool result that says a file is missing, truncated or duplicated as **unverified** until an absolute-path Read (or `git show HEAD:<path>`) says otherwise. Only repair what you have actually seen.

**Why:** Search tools resolve relative paths against the shell's persisted CWD. After a `cd` into one app, a repo-root-relative search reports "Path does not exist" and looks exactly like a corrupted file. Long tool outputs get truncated or interleaved. Multi-line edits on prose files silently join lines.

**How to apply:**
- Prefix paths with the repo root, or `cd "$(git rev-parse --show-toplevel)"` first
- After editing wrapped docs, re-Read the edited region
- Check for join signatures (`.‑ **`, `one.- `)
- Read `git log -1 --format=%B` back after heredoc commits
- Before attributing a red test to the machine, check whether the two environments differ in *state*, not just load

### Absolute Path Reads

Always use absolute paths when reading files. Relative paths resolve against the shell's persisted CWD, which may have changed from a previous command.

### Git Show for Ground Truth

When a tool claims a file is broken, check `git show HEAD:<path>` first. The file may be fine; the tool result may be stale or misinterpreted.

### Load vs State Diagnosis

Before calling a failure "environment noise", check:
- Load: per-process CPU delta over a few seconds
- State: local database seeded vs CI's cold start

On 2026-09-29, a failure was called environment noise twice and was wrong both times; CI's first clean run found a real defect that sixty-five local runs could not see, because the local database was already seeded and the cold one was not.

---

## Tool Artifacts & Pitfalls

### ESLint Hook Shows Stale Snapshot

The PostToolUse eslint hook shows a stale snapshot of the file. Its messages can name lines that no longer exist. Ground truth is `bun run test`, `bun run typecheck` and a fresh `Grep`, not the hook's complaint.

### Sed Eats Curly Quotes

`sed` (and other line tools) can eat the curly quotes in prose. This codebase writes `'` inside single-quoted strings and em-dashes in comments, so a `sed` edit can turn a working string into a syntax error several lines away. Prefer the Edit tool on files with prose in them.

### Detached DOM Nodes

Querying a DOM node captured before a re-render tests a detached tree. A `screen.getByText(...)` handle held across an interaction keeps pointing at the node React replaced. Re-query (or assert absence with a fresh `queryBy*`) after anything that re-renders.

### Vitest toMatchObject Absent-Key Semantics

Vitest's `toMatchObject` does not match an absent key against `undefined`. A request body that omits a field fails an expectation written as `{ field: undefined }`. Assert the key is gone instead.

### Supertest Nested-Request ECONNREFUSED

`ECONNREFUSED` on a Nest e2e request can be a second request nested inside the first chain. Writing `.set('Authorization', \`Bearer ${await bearer()}\`)` starts the login request while the outer `Test` object already exists, and supertest closes the ephemeral listener it opened when that inner request finishes. Await the token on its own line first.

### Prettier Creates ESLint Errors

Prettier can create an eslint error you did not write. A computed supertest verb — `request(server)[method](url)` — trips `no-unexpected-multiline` as soon as the line is long enough for Prettier to break the member chain. Make the expression fit one line (hoist the auth header into a short variable) rather than fighting the reflow.

### Gh Run View Returns Nothing

`gh run view --log` and `--log-failed` can return *nothing at all* for a run GitHub reports as failed. Get the job id from `gh api repos/<owner>/<repo>/actions/runs/<runId>/jobs`, then `gh api repos/<owner>/<repo>/actions/jobs/<jobId>/logs`.

### Screen Ignores Container Option

`screen.getAllByRole(..., { container })` ignores `container`. `screen.*` queries are pre-bound to `document.body`. Use `within(node).getAllByRole(...)`.

### Window ResizeTo Changes OuterWidth

`window.resizeTo` changes `outerWidth` and leaves `innerWidth` alone, so a narrow browser-use viewport cannot be widened from a script. Read `window.innerWidth` before interpreting a wrapped label as a layout defect.

### WebSearch Can Be Refused

`WebSearch` can be refused by the permission classifier, including for benign lookups. Do not let the answer imply the check was done: say the availability could not be verified and offer candidates anyway.

### Grep Over Whole Repo Hangs

`Grep -r`/`grep -rn` over a whole repo hangs this shell and gets backgrounded. The Grep tool answers the same question in one call. Same for `find /` — scope it to `.` or a subpath.

---

## Environment Setup

### Postgres Server

Local Postgres: server **17.4** on localhost, reachable as superuser `postgres`.

**Available extensions:** `pg_trgm`, `btree_gist`, `pgcrypto`, `uuid-ossp`. **PostGIS is NOT installed**.

**Databases:** `lms` for dev API, `lms_test` for API suite.

**Scope commands explicitly:** Both databases now exist. Vitest's global setup runs `prisma migrate deploy` against `lms_test` on its own and seeds it, while the dev `lms` needs `db:migrate` *and* `db:seed` run by hand.

This server also hosts many unrelated project databases. **Scope every command explicitly to `lms` / `lms_test`; never run drop/truncate/reset at server level.**

### Demo Accounts

Seed accounts written by `db:seed`:
- `teacher@example.test` / `lms-demo-password`
- `student@example.test` / `lms-demo-password`
- `ops@example.test` / `lms-demo-password`

A guess like `teacher@localtest.me` answers `401 INVALID_CREDENTIALS` on a perfectly healthy API — that is a wrong address, not a broken session.

### Stop API Before Migrate

Stop the API before `bun run db:migrate` / `db:generate`. The migration ends with `prisma generate`, which fails with EPERM on `query_engine-windows.dll.node` while the API is alive.

Find the listener:
```bash
netstat -ano | grep ":4000" | grep LISTENING
taskkill //PID <pid> //F
```

Then migrate, then relaunch:
```bash
(bun run dev:api > /tmp/lms-api-dev.log 2>&1 &)
```

From the repo root, since `dev:api` is a root `--filter` script.

### New Lookup Codes Not Seeded by Migration

After adding lookup values to the reference seed, run `bun run --filter @lms/api db:seed` against the dev DB (idempotent, refuses under `NODE_ENV=production`). Until then every create through an endpoint that resolves one answers 500 with `Reference value <Type>/<code> is not seeded`.

### One Browser Profile = One Signed-In Account

`COOKIE_DOMAIN=localtest.me` makes the refresh cookie shared by every portal, so signing in as the student in a profile that has a teacher tab open will, on the next *full page load*, show the teacher. Verify two roles in two profiles/private windows.

To switch which account the shared cookie belongs to, skip the sign-in form:

```javascript
evaluate_script with:
fetch('http://api.localtest.me:4000/api/v1/auth/login', {
  method:'POST',
  credentials:'include',
  headers:{'content-type':'application/json'},
  body: JSON.stringify({email, password})
})
```

Rotates the cookie to that account, and the next **full page load** bootstraps the new session.

---

## Phase Gating Protocol

### TDD Order, One Feature Finished Before Next

For the LMS POC, follow the phase protocol exactly: plan, get explicit approval, implement **only** the approved phase, then stop and report before the next phase. Never assume approval or continue automatically. A go-ahead is usually terse ("You have a go ahead", "Lets complete this section") and covers exactly the one step just named.

### Within a Phase

Write the failing test first and show its output before implementing. A feature is not "done" until:
- Tests pass
- Backend is complete
- UI covers loading/empty/error/success states
- **The golden path and the refusals have been clicked through in the browser**
- Work is reviewed
- It is committed

### Present Plan Plus Scoping Questions

Present the plan plus 2–3 scoping questions on the genuinely load-bearing choices before writing code. The user answers them concretely, then says go. Do not ask about things the codebase already decides.

### Update Phase Plan First

When handed a new capability for a later phase, update the phase plan in the docs first and commit that on its own, before designing or coding anything.

### Ship Each Entity as Two Chunks

Ship each entity as two separately approved chunks — API first, then its portal screen — and commit them apart. A phase is split into *numbered* chunks and the user green-lights them one at a time. A go for chunk N is not a go for N+1.

### Report Browser Verification Footprint

Report what browser verification wrote into the dev data, since there are no hard deletes to tidy it up.

---

## System Prompts That Worked

### Primary System Prompt Structure

The following structure produced exceptional results throughout Hourloom's development:

```
You are a senior software engineer building a production-grade [domain] platform.

Core principles:
1. Test-driven development: write failing test first, show output, then implement minimum
2. Phase-gated: one feature complete before next begins, stop for approval at boundaries
3. Production-minded: browser verify golden path + refusals, commit with conventional messages
4. Use installed skills instead of hand-rolling equivalents

Architecture constraints:
- [List key architectural decisions]
- [List technology stack]
- [List integration patterns]

Quality bar:
- [List frontend design rules]
- [List testing requirements]
- [List documentation standards]

When uncertain:
- Ask 2-3 scoping questions on load-bearing choices
- Verify file state with absolute-path Read before repairing
- Ground truth is tests + typecheck + grep, not tool complaints

Current task: [specific task description]
Context: [relevant background]
Constraints: [any limitations]
```

### What Made It Work

1. **Explicit phase protocol**: "stop for approval at boundaries" prevented runaway generation
2. **Test-first mandate**: "write failing test first" ensured correctness before implementation
3. **Production quality bar**: "browser verify golden path + refusals" caught real issues
4. **Skill utilization**: "use installed skills" leveraged existing investments
5. **Verification discipline**: "ground truth is tests + typecheck + grep" avoided tool artifacts
6. **Scoping questions**: "ask 2-3 questions on load-bearing choices" got concrete answers upfront
7. **Incremental shipping**: "two chunks — API first, then portal" kept reviews manageable

### Tone Instructions

```
Tone: concise, direct, professional. No emojis. One sentence per update at key moments. 
End-of-turn summary: what changed and what's next. Match response length to task complexity.
```

### Context Management

```
Assume users can't see most tool calls or thinking — only your text output. 
State results and decisions directly. Don't narrate internal deliberation.
```

---

## Skills Used

### Installed Skills

1. **frontend-design**: Create distinctive, production-grade frontend interfaces with high design quality
2. **transitions-dev**: Production-ready CSS transitions for web apps (notifications, dropdowns, modals, etc.)
3. **git-commit**: Execute git commit with conventional commit message analysis
4. **multi-reviewer-patterns**: Coordinate parallel code reviews across multiple quality dimensions
5. **find-skills**: Discover and install agent skills when looking for functionality

### When to Use Each

- **frontend-design**: When building UI surfaces, components, pages, applications
- **transitions-dev**: When implementing animations, toasts, state changes, page transitions
- **git-commit**: When committing changes (always use instead of manual commits)
- **multi-reviewer-patterns**: At end-of-phase review, before cutting releases
- **find-skills**: Before starting a new concern, when wondering "is there a skill for X?"

### Skill Invocation Pattern

```
/Skill frontend-design
Args: Design the [component/page] for [purpose], following [constraints]
```

---

## Release Protocol

### Release Script

`bun run release vX.Y.Z` runs:
1. Refuses dirty tree / non-`main` / existing tag
2. Runs `bun run verify` and stops if not green
3. Writes an **annotated** tag
4. Pushes `main` + the tag
5. Creates GitHub release via `gh release create --verify-tag`

`--dry-run` and `--skip-verify` flags exist.

### Tag Meaning

**A tag means a closed phase, not a deploy.** Versions track the phase table. `main` carries in-flight work ahead of the newest tag, so tag *after* a phase closes rather than moving a tag around.

### Windows Box Gate Step

On this Windows box the release script's gate step must run through a shell. A red gate inside `release` stops before anything is tagged or pushed, which is the script behaving correctly.

### Remote Configuration

Remote is `git@github.com:ritiksaxena124/lms-platform.git`, **public**, `gh` authed with `repo` scope. Pushing is a shared-state action: ask each time rather than treating one approval as standing.

---

## Key Lessons Learned

### 1. Measure Twice, Cut Once

Before attributing a red test to the machine, check whether the two environments differ in *state*, not just load. A busy box and a cold-start race produce the same report. Load is cheap to measure; state is the one that a long-lived local box hides and a fresh CI container exposes.

### 2. Tool Results Are Hypotheses

A tool result that contradicts the file is unverified; a tool result that contradicts *another machine* is a hypothesis. Say which one you have before writing the repair.

### 3. Budget for Confirmation

Any time a tool result suggests existing work is broken, spend one Read confirming it before writing. Budget for the confirmation rather than the repair.

### 4. Stale Processes Hide Real Bugs

A stopped background process can leave children running. Killing the wrapper leaves nest children holding ports, and a stale NoMail process keeps running delivery cron. Re-check `netstat -ano` before concluding an environment value failed.

### 5. Cold Start Exposes What Warm Hides

CI starts from an EMPTY test database on every push. Local box is always warm. A cold-start race is invisible locally AND unreproducible locally. CI is the only cold environment.

### 6. Assertion Traps Multiply Under Contention

- Whole-table counts race across parallel forks
- `supertest`'s `.expect(fn)` gets the whole Response and fails only if `fn` throws
- Throttler answers 429 before a helper's login does
- Postgres returns `jsonb` keys ordered by value length, not insertion order

### 7. Prettier Reflow Recovery

When bulk prettier run reflows files you only added one line to, do not hand-revert. Rebuild each one as HEAD-plus-that-line in a single script, then confirm `git diff --numstat` shows 1 insertion per file.

### 8. Browser Automation Limits

- `take_screenshot` does not work (hidden viewport). Use `take_snapshot` for a11y tree and `evaluate_script` for row text and toasts
- React-controlled inputs need native value-setter + `input`/`change` event to be filled from script
- Native `<select>` cannot be clicked. Select by calling `fill` on combobox uid with option's underlying **value**
- Uids rotate with every snapshot. Snapshot immediately before each interaction

---

## Applying This to New Projects

### Day 1 Setup

1. Initialize git repo + Bun workspace foundation
2. Establish phase protocol with user
3. Set up Postgres with least-privilege role
4. Create demo seed accounts
5. Build API foundation with health check
6. Wire Prisma with soft-delete pattern
7. Build shared package (codes, money, timezone)
8. Build UI kit with Storybook
9. Establish dev domain strategy for session sharing

### Per-Phase Workflow

1. **Plan**: Present scope, timeline, scoping questions
2. **Approve**: Get explicit go-ahead
3. **Test**: Write failing test first
4. **Implement**: Minimum viable implementation
5. **Verify**: Browser test golden path + refusals
6. **Commit**: Conventional commit message
7. **Report**: What shipped, what footprint remains
8. **Stop**: Wait for next phase approval

### Quality Gates

- All tests green (vitest only, never bare bun test)
- Typecheck passes
- Lint clean
- Browser verification completed
- Docs updated
- README status line updated
- Committed with conventional message
- Tagged and released if phase closed

---

## Contact & Attribution

This playbook was distilled from building **Hourloom** (v0.13.0), a multi-portal LMS platform for independent teachers, across 13 phases from September 2026.

**Tech stack:** Bun workspaces, NestJS 11, Next.js 16, Prisma, Postgres 17.4, Tailwind v4, React Hot Toast, Storybook, Vitest.

**Repository:** github.com/ritiksaxena124/lms-platform

**License:** Apply the same incremental, test-driven, phase-gated approach to your next project.
