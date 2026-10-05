# Run it locally

You need Bun 1.2 or newer, Node 22 or newer, and a Postgres 16+ server with the `pg_trgm` and
`btree_gist` extensions. The API and the portals talk to that one server.

## First run

```bash
bun install

# The .env files are generated locally and never committed.
cp apps/api/.env.example apps/api/.env       # DATABASE_URL points at the lms database
cp apps/api/.env.example apps/api/.env.test  # DATABASE_URL must point at lms_test
# JWT_SECRET has no default in either file; generate one:  openssl rand -hex 32

cp apps/teacher/.env.example apps/teacher/.env.development
cp apps/student/.env.example apps/student/.env.development
cp apps/ops/.env.example apps/ops/.env.development
cp apps/site/.env.example  apps/site/.env.local

bun run --filter @lms/api db:generate
bun run --filter @lms/api db:migrate
bun run --filter @lms/api db:seed

bun run dev
```

`db:seed` writes the reference rows the application reads — the roles, the course statuses, the
currencies — and three demo accounts, one per role. It prints the addresses and the password it gave
them. They are also listed under **Signing in** in the repository README, which is where a person
sitting at their own keyboard should read them rather than from a page on the public internet.

## Where each thing listens

| Port | What is there            |
| ---- | ------------------------ |
| 4000 | The API, under `/api/v1` |
| 3000 | The teacher's portal     |
| 3001 | The student's shelf      |
| 3002 | The operator's desk      |
| 3003 | This page and these docs |

Open them as `teacher.localtest.me:3000`, `student.localtest.me:3001` and
`ops.localtest.me:3002` rather than as `localhost`. `*.localtest.me` resolves to `127.0.0.1` and
gives each portal a subdomain of one registrable domain, which is what lets them share a session
cookie in development without CORS workarounds.

One shared cookie has one consequence worth knowing before you start clicking: a browser profile is
signed in as one account at a time, across all the portals. To watch the same course as both the
teacher who published it and the learner who booked it, open a second profile or a private window.

## Or run it in containers

`bun run dev` is the everyday path. For handing the whole product over — same code, one command, no
setup on the receiving machine — the repository also builds it as six images behind one gateway:

```bash
cp docker/.env.example docker/.env.docker   # then set JWT_SECRET:  openssl rand -hex 32

bun run docker:build
bun run docker:up
bun run docker:seed
```

The same five things then answer without a port number: `teacher.localtest.me`,
`student.localtest.me`, `ops.localtest.me`, `site.localtest.me` and `api.localtest.me`, all on the
plain-HTTP gateway that keeps the cookie domain and the CORS allowlist exactly as the section above
describes them. The stack's Postgres is not published, so it does not collide with the server your
host run uses. Nothing here pushes an image to a registry or deploys anywhere; the images live on the
machine that built them.

Two properties of that shape are easy to get wrong and are guarded by `bun run docker:check`, which
runs inside `bun run verify`: a `NEXT_PUBLIC_*` value is fixed when the image is built rather than
when it starts, so a portal reading a new one needs a build argument; and the API listens on
`127.0.0.1` unless `LISTEN_HOST` says otherwise, which is right on a laptop and unreachable from
another container.

## Checking your work

```bash
bun run verify
```

That builds `packages/shared`, typechecks, lints and runs every package's tests in sequence. It is
the same command CI runs on every push, so a green run locally and a red run in CI are the same
event — the difference being that CI starts from an empty database, which is where the suite's
startup races show up and where a warm local database hides them.

The API tests run against `lms_test` and refuse to run against anything else.

## The demo loop

The shortest walk through the whole system: sign in as the teacher, publish a course and mark one
lesson free, open an evening on the availability calendar, then sign in as the learner in another
profile, read the free page, take a place and ask for that minute. The teacher answers yes, which
gives the class a room and tells both of them by email. Then sign in as the operator and find the
same decisions in the activity log.

Two turns of that walk depend on a setting. Take a place on a course that carries a price and it comes
back held rather than open; it opens when the learner pays, which needs `PAYMENT_PROVIDER=mock` — with
the default `none` the API says up front that this box takes no money and writes nothing. And once the
booked minute has passed, the teacher's class list offers a mark for it, taught or missed, which is how
a 1:1 ends.
