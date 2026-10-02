# Contributing to Hourloom

Every change to this repository travels the same road: a branch off `develop`, a pull request with a
description a stranger could act on, a merge, and a tag only when the gate is green. Nothing is pushed to
`main` by hand.

## The branches

| Branch    | What lives there                                          | Who may merge into it            |
| --------- | --------------------------------------------------------- | -------------------------------- |
| `main`    | Released history. Every tag points here.                  | Only a merged `release` PR       |
| `release` | The line being stabilised: fixes for what is already cut. | Only PRs from `develop`          |
| `develop` | Integration. Work lands here first and is tested here.    | Any PR with the checks passing   |
| `feat/*`  | One feature, one author, short-lived.                     | Nobody — it only ever opens a PR |
| `fix/*`   | One repair to shipped behaviour, short-lived.             | Nobody — it only ever opens a PR |

`develop` and `release` are cut from `main`. A work branch is cut from `develop`, never from `main`: a
branch off `main` silently excludes whatever has already been integrated.

```
main ──────●───────────────────●  (tag v0.15.1)
            ╲                 ╱
release ─────╲───●───●────────   fixes only, nothing new
              ╲       ╱
develop ───────╲─●─●─╱─●─●────   every merged PR lands here first
                   ╱
feat/* ────────────╳  deleted after the merge
```

## Running it while you change it

There are two ways to have Hourloom in front of you and they are not interchangeable: the **host run** is
where you edit, the **container run** is where you hand the product to somebody. Nothing about day-to-day work
needs a Docker daemon — not `dev`, not a test run, and not the `docker:check` step inside `bun run verify`,
which reads the compose files as text.

### On the host, while editing

Setup is the README's *First run*: `bun install`, copy each app's `.env.example` to the file it reads (the
API needs two, one at `lms` and one at `lms_test`), generate a `JWT_SECRET`, create both databases on the
local Postgres, then `db:generate`, `db:migrate`, `db:seed`.

```bash
bun run dev      # api :4000, teacher :3000, student :3001, ops :3002, site :3003
```

Usually not that. One app at a time is the normal shape — `dev:api`, `dev:teacher`, `dev:student`, `dev:ops`,
`dev:site`, `dev:ui` — because five watchers on one machine are five processes competing for the same cores
and you are only ever reading one of the ports.

Five facts that cost a morning each the other way round:

- **Open `http://teacher.localtest.me:3000`, never `http://localhost:3000`.** The session cookie is scoped to
  `Domain=localtest.me` and the API answers CORS only to the `localtest.me` origins, so a portal on `localhost`
  is not merely unsigned-in — it is cut off from its API, and its shelf says so by naming the address it wants.
- **`packages/shared` reaches every app as built `dist`, not as source.** An edit there does nothing to a
  running portal until `bun run build:shared` writes it. `dev:api` runs that build for itself as a `predev`
  hook; the portals do not, and neither does a per-app test command — only the root `verify` starts with it.
- **One signed-in account per browser profile**, because the cookie is shared across the subdomains on
  purpose. Being the teacher who published a course and the student enrolled in it at once needs a second
  profile or a private window, not a second tab.
- **`bun run dev:ui` is Storybook on :6006**, which is where a new or changed `@lms/ui` primitive gets looked
  at before it is wired anywhere. Every primitive has a story; a change without one is a change nobody reviewed.
- **The host run and the container run are two different databases.** The stack's Postgres publishes no port,
  so a course seeded on the host is absent from the containers and the other way round. That is not a bug, but
  it explains an empty shelf in front of a stack you thought you had just seeded.

The loop while editing is per-app, not repo-wide:

```bash
bun run --filter @lms/api test:watch    # the API suite; its global setup applies migrations to lms_test
bun run --filter @lms/teacher test      # one portal's suite
bun run typecheck && bun run lint       # both cheap, both in the gate
```

The suites that touch rows refuse to run against anything but `lms_test` — `apps/api/test/global-setup.ts`
checks the database name in the URL for you, because two spec files sweeping the same booking table is a
flaky test suite pretending to be a bug in the code.

### In containers, for a hand-off or a demo

```bash
cp docker/.env.example docker/.env.docker    # then set JWT_SECRET:  openssl rand -hex 32

bun run docker:build     # six images, one at a time on purpose
bun run docker:up        # postgres -> migrate -> api + three portals + site -> gateway
bun run docker:seed      # the lookups and the demo accounts; `up` never writes them
```

Then the four `*.localtest.me` addresses with no port on the end — one nginx gateway answers `:80` and routes
by subdomain. The README's *Running the stack in containers* explains why the shape is what it is; two things
that bite here rather than there:

- `docker/.env.docker` is read for **build `ARG`s** as well as by the API, so changing a `NEXT_PUBLIC_*` value
  there means `bun run docker:build`, not a restart. The `.env.*` pattern in `.gitignore` is unanchored, so the
  file is ignored at `docker/` exactly as it is under `apps/` — it holds a secret and stays out of history.
- `bun run docker:down` stops the stack and leaves both named volumes. `docker compose down --volumes` is the
  command that deletes the rows and the uploaded lesson bytes with them, and nothing warns you first.

### Why there is no container dev mode

The obvious next request is an overlay that runs the same five services in watch mode with the repository
mounted, so the container path becomes the editing path too. That was built and it does not work on Windows,
for reasons that belong to the toolchain rather than to this repository:

- Docker Desktop shares the drive over `9p` and carries **no file-system events** into a Linux container, so no
  watcher in a bind mount ever sees a save. Checked twice — `next dev` and `tsc --watch` both sat idle while the
  file's new content was plainly readable from inside the container.
- **Turbopack has no polling mode**, so the flag that would fix the line above does not exist.
- Dropping to `next dev --webpack` hits a different wall: Next's fast-refresh loader injects
  `import.meta.webpackHot.accept()` into `packages/shared/dist`, which is CommonJS, and the dev compile fails
  with `Cannot use 'import.meta' outside a module`.
- Copying the source into a Linux volume with a host-side syncer moves the problem instead of solving it: the
  syncer is still a watcher, on a filesystem whose events it would have to poll for.

So images are built by Docker and watched by `bun`, each doing the one it is good at. If this is revisited,
revisit it on a Linux host, and before writing any compose file check that one watcher there notices one save.

## The loop

1. **Start from `develop`.** `git checkout develop && git pull`, then
   `git checkout -b feat/course-module-screen`.
2. **One feature at a time.** A branch that carries two unrelated changes cannot be reviewed, reverted, or
   released on its own. Split it.
3. **Test first.** Write the failing test, watch it fail for the reason you expect, then implement. A bug
   fix arrives with a test that would have caught it. Then open the screen you changed on the host run — see
   *Running it while you change it* — because a green suite says the code is correct, not that the feature is
   there.
4. **Run the gate before you push.**
   ```
   bun run verify              # whole repository
   bun run test                # in the app you touched
   bun run typecheck && bun run lint
   ```
   A route or a table changed → regenerate what the docs are built from, and commit the artifact with the
   code: from `apps/api`, `bun run docs:export` and `bun run docs:data`.
5. **Commit** in the format below. Stage by name, never `git add -A` — the working tree of this repository
   holds local `.env` files that must stay out of history.
6. **Push the branch and open a PR into `develop`.** Never `main`, never `release`.
7. **Merge with a squash only when the branch is a mess of "wip" commits.** Otherwise keep the commits: the
   history is the documentation of why the shape changed. Delete the branch after the merge.
8. **To ship**: `develop` → `release` (a PR) → `main` (a PR) → tag. The tag is what a demo, a hand-off or a
   rollback points at.

## Where the check runs

`.github/workflows/ci.yml` runs `bun run verify` on **every pull request** and on a push to `main`. It does
not run on a push to `develop` or `release`, so those branches are only checked at PR time — which holds as
long as nothing lands on them except through a PR.

Inside that gate is `bun run docker:check` (`scripts/docker-check.mjs`), which needs no Docker daemon: it
reads the compose file, the Dockerfiles, the gateway config and the portal sources and fails when an app has
no service, when a portal reads a `NEXT_PUBLIC_*` key no Dockerfile passes in as a build `ARG`, when the
gateway has stopped answering one of the five hostnames, or when `.dockerignore` has let a `.env` file or
`apps/api/storage` back into the build context. It is in the chain rather than in a separate job because the
container shape is edited one file at a time, and the failure it prevents — a portal built pointing at
`undefined` — only surfaces in a browser.

`main` is **not yet protected** on GitHub: nothing stops a hand-push except this file and the person reading
it. Two changes close that gap, and both need the maintainer's explicit go-ahead because they alter shared
state — adding `develop` and `release` to the workflow's `push` branches, and turning on protection for
`main` and `develop` so a merge needs the green check and one review.

## Commit messages

Conventional commits, one intent per commit, imperative and under 72 characters:

```
<type>(<scope>): <what changed, and the effect>

<body: why it changed, what was wrong before, what a reader must know to review it>
```

| Type     | Use it for                                                |
| -------- | --------------------------------------------------------- |
| `feat`   | Something a user could not do before                       |
| `fix`    | Behaviour that was wrong                                   |
| `refactor` | No change in what the user gets                          |
| `test`   | Tests alone                                                |
| `docs`   | README, ARCHITECTURE, `apps/site/content`, this file       |
| `perf`   | Measurably faster                                          |
| `chore`  | Tooling, dependencies, generated artifacts                 |

Scopes are the workspace names: `api`, `teacher`, `student`, `ops`, `site`, `ui`, `shared`, `deps`.

The body is not a summary of the diff. It answers the question the diff cannot: *why* this and not the
obvious alternative.

## Pull requests

**Title** — the same shape as a commit subject, because it becomes the merge commit:
`feat(student): a lesson page carries the reader to the next page`.

**Description** — these four parts, in this order:

- **What a user gets.** One paragraph, in the product's language, not the code's.
- **Why now.** The report, the phase, or the gap that asked for it. Link the task.
- **How it was verified.** The failing test first, then the commands that were green, then the browser walk
  with the host you used. A UI change that was not opened in a browser says so out loud rather than
  implying it.
- **What it does not do.** The follow-ups you noticed and deliberately left alone, so they are not lost and
  not smuggled in.

A PR is a request to review, so it must be small enough to review. If it is not, split it before you open it.

## Release policy — why the number still means something

A release is a **phase boundary**, not a deploy. `main` carries work in flight; a tag says *this commit
passed the gate*.

| Situation                                                | Slot                |
| -------------------------------------------------------- | ------------------- |
| A repair to behaviour that already shipped               | **patch** — `v0.15.1` |
| Copy, tests, accessibility, design-token discipline      | **patch**           |
| A page or endpoint a user could not reach before         | **minor** — `v0.16.0` |
| A roadmap row changing status in the README phase table  | **minor**           |
| A change to what the wire or the schema means            | **minor**, discussed first |

Patches **accumulate and go out together**. Six fixes are one tag, not six. Without this rule the version
number stops carrying information and the repository ends up with a hundred releases that all mean
"something small changed".

The version line today: `v0.15.1` is published on origin at `fb33ba3`, and `develop`, `release` and `main` are
that same commit. So the next patch on that line is **`v0.15.2`**, and the next new capability is
**`v0.16.0`**.

Cutting a release:

```
bun run release v0.15.1 --title="Patch: the student reading path"
bun run release v0.15.1 --dry-run          # look first
```

`scripts/release.mjs` refuses a dirty tree, a branch that is not `main`, and a tag that already exists on
origin. It runs `bun run verify` and stops if the gate is not green, writes an **annotated** tag, pushes
`main` and the tag, and opens the GitHub release.

**Pushing, tagging and releasing are shared state.** Do it when the maintainer has asked for that specific
action — once, for that number — not as an assumed last step of a task.

## House rules, restated because they are broken most often

- **Nothing is destroyed.** Rows retire with `isActive: false`; no hard delete, no cascade, no column that
  drops history.
- **Prisma schema field names are the contract.** A `snake_case` column becomes the exact `camelCase` field
  the schema declares — read the schema, do not guess the variation.
- **Design system: Graphite.** Inter and nothing else, kit tokens and primitives only, no shadow that does
  not earn its place, `notify` for feedback, no native `confirm()` or `alert()`. New or changed primitives
  get a Storybook story.
- **Do not run repo-wide `bun run format`.** Prettier reflows files that were deliberately hand-formatted and
  turns a small diff into an unreadable one. Format the lines you wrote.
- **The operator's desk is not advertised**, and the demo password belongs in the README and nowhere a page
  publishes — not in a docs file, a test fixture printed in CI, or a screenshot.
- **Money is stored in minor units** with a currency beside it, and an amount is never formatted with a
  hardcoded currency code.

## Where documentation lives

| File                              | Audience                                    |
| --------------------------------- | ------------------------------------------- |
| `README.md`                       | The phase record, the walk-through, the rules |
| `ARCHITECTURE.md`                 | Why the system is shaped like this          |
| `docs/contributing.md`            | This file: how to run it, and how work moves |
| `apps/site/content/*.md`          | The public manual, rendered at `/docs`      |

The public docs pages are generated: the route table from the running Nest app, the column table from
`schema.prisma`, the phase table from the README. A page added there needs its entry in the docs manifest and
a passing site suite — and it is public, so the two rules above about the ops desk and the demo password apply
to it in full.

## Worked example — the first PR chain on this model

1. `feat/student-reading-path` off `develop`: the lesson pager, plus its tests. PR → `develop`.
2. `fix/student-session-role` off `develop`: a non-learner session is named instead of shrugged at. PR → `develop`.
3. `fix/coupon-currency-and-kit` off `develop`: the hardcoded `INR`, the raw Tailwind classes, the dead pill
   branch, the dialog description. PR → `develop`.
4. `develop` → `release` → `main`, then `bun run release v0.15.1 --title="Patch: the student reading path"`.
5. The module screen and the calendar that generates are a **new capability**: `v0.16.0`, and the README phase
   row moves from `Partial` to `Done` in the same PR chain.
