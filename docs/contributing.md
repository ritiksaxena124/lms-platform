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

## The loop

1. **Start from `develop`.** `git checkout develop && git pull`, then
   `git checkout -b feat/course-module-screen`.
2. **One feature at a time.** A branch that carries two unrelated changes cannot be reviewed, reverted, or
   released on its own. Split it.
3. **Test first.** Write the failing test, watch it fail for the reason you expect, then implement. A bug
   fix arrives with a test that would have caught it.
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
| `docs/contributing.md`            | This file: how work moves                   |
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
