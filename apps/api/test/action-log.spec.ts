import type { INestApplication } from '@nestjs/common';
import { Controller, Post, Query } from '@nestjs/common';
import { PrismaClient, type ActionLog as ActionLogRow } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACTION_CODES,
  ACTION_SECTION_CODES,
  API_ERROR_CODES,
  LKP_TYPE_CODES,
  ROLE_CODES,
  type RoleCode,
} from '@lms/shared';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { runWithLogContext } from '../src/common/logging/log-context';
import { ActionLogModule } from '../src/modules/action-log/action-log.module';
import type { ActionActor } from '../src/modules/action-log/action-recorder';
import { ActionRecorder } from '../src/modules/action-log/action-recorder';
import { OptionalSession } from '../src/modules/auth/optional-session.decorator';
import { Public } from '../src/modules/auth/public.decorator';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The two shapes Phase 7's writes will have, met at the HTTP edges that decide between them.
 *
 * A standing-row change happens behind `JwtAuthGuard`, so the recorder can read its actor off the
 * request. The four account events happen on `/auth/*`, which is `@Public()`, so there is nobody in
 * the request to read and the caller has to name the account it just loaded or wrote. Those two
 * routes are the whole difference between `record` and `recordAs`.
 *
 * Neither shape can be shown without a live transaction, which is why this file boots the app rather
 * than unit-testing a class. And two claims carry the phase, both proved here: a row names the
 * person the *server* resolved, in the role that account held at the moment of the action — no route
 * is trusted to say who was asking, and a route that could is a route that can blame anyone. And the
 * row and the change it describes are one unit of work, so a write that fails on its last statement
 * leaves no record of a decision nobody can point to afterwards.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma: PrismaClient = new PrismaClient();
let recorder: ActionRecorder;

/** Rows this file creates, so the ledger it leaves behind is empty when it finishes. */
const rowIds: string[] = [];
const collect = async (promise: Promise<ActionLogRow>): Promise<ActionLogRow> => {
  const row = await promise;
  rowIds.push(row.id);
  return row;
};

/** A course id this file invents: `target_id` carries no foreign key, and 7a proved a row may name
 * a thing that is not there — which is what lets a September record outlive an archived course. */
const SOME_COURSE = randomUUID();

/**
 * The three verbs a Phase 7 call site will have, on the three kinds of route that reach them.
 *
 * Each handler returns the row it filed only so a test can read the object the transaction
 * committed; 7c's routes will return their own resources and leave the record underneath them.
 */
@Controller('_action-probe')
class ActionProbeController {
  constructor(
    private readonly actions: ActionRecorder,
    private readonly db: PrismaService,
  ) {}

  /** The common shape: a write inside a transaction, attributing itself to the resolved session. No
   * `@CurrentUser()` anywhere in this handler — the guard bound the actor for everything the request
   * goes on to do, several calls down. */
  @Post('record')
  async record(): Promise<ActionLogRow> {
    return this.db.$transaction((tx) =>
      this.actions.record(tx, {
        action: ACTION_CODES.COURSE_PUBLISHED,
        targetId: SOME_COURSE,
        detail: { from: 'draft', to: 'published', priceAfter: 3900 },
      }),
    );
  }

  /** The same call on a route that resolves a session without demanding one — `@OptionalSession()`,
   * which is what the three catalog reads are today and what `/auth/logout` becomes in 7c-3. The
   * guard fills the context for a caller who brought a token, so this records; with no token there
   * is nobody to read, so the recorder refuses. 7c-3's account events have to work on exactly this
   * middle route. */
  @OptionalSession()
  @Post('optional')
  async optional(): Promise<ActionLogRow> {
    return this.db.$transaction((tx) =>
      this.actions.record(tx, {
        action: ACTION_CODES.ENROLLMENT_JOINED,
        // A place that was never taken. `target_id` has no foreign key, which 7a pinned: the record
        // outlives the row, so it cannot be held hostage by it either.
        targetId: randomUUID(),
      }),
    );
  }

  /**
   * The account events, filed the only way they can be.
   *
   * The request id still arrives, because the middleware put it there for every request — which is
   * the pair worth seeing together: a row from a sign-in has no session behind it and does have the
   * request that carried the credentials, so the two halves of the attribution come from two
   * different places, and neither is the caller's invention.
   */
  @Public()
  @Post('account')
  async signIn(@Query('name') name: string): Promise<ActionLogRow> {
    const account = await this.accountFor(name);
    return this.db.$transaction((tx) =>
      this.actions.recordAs(account, tx, {
        action: ACTION_CODES.SIGNED_IN,
        targetId: account.userId,
      }),
    );
  }

  /** The same event through `record`, on the route where there is no session to read. This is the
   * mistake `recordAs` exists to excuse, so the recorder has to refuse it: a `/auth/*` route that
   * reached for the context would file a person's action against nobody. */
  @Public()
  @Post('account-unbound')
  async signInUnbound(@Query('name') name: string): Promise<ActionLogRow> {
    const account = await this.accountFor(name);
    return this.db.$transaction((tx) =>
      this.actions.record(tx, { action: ACTION_CODES.SIGNED_IN, targetId: account.userId }),
    );
  }

  /** The way `AuthService` will have it: the account an event is about is the one this request is
   * for, and its role is read off the row rather than asserted by whoever called. */
  private async accountFor(name: string): Promise<ActionActor> {
    const user = await this.db.user.findFirstOrThrow({
      where: { email: emailFor(name) },
      select: { id: true, role: { select: { code: true } } },
    });
    return { userId: user.id, userRole: user.role.code as RoleCode };
  }
}

async function bearer(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

const accountId = (name: string) =>
  prisma.user.findFirstOrThrow({ where: { email: emailFor(name) } }).then((user) => user.id);

async function setRole(name: string, code: string): Promise<string> {
  const id = await accountId(name);
  const role = await prisma.lkpValue.findFirstOrThrow({
    where: { type: { code: LKP_TYPE_CODES.USER_ROLE }, code },
  });
  await prisma.user.update({ where: { id }, data: { roleValueId: role.id } });
  return id;
}

beforeAll(async () => {
  await seedLookups(prisma);
  app = await createTestApp({
    imports: [AppModule, ActionLogModule],
    controllers: [ActionProbeController],
  });
  recorder = app.get(ActionRecorder);

  // `author` is the teacher the session-bound writes are attributed to and `reader` the student the
  // account events are, because those two halves of Phase 7 arrive through different routes.
  for (const [name, role] of [
    ['author', ROLE_CODES.TEACHER],
    ['reader', ROLE_CODES.STUDENT],
  ] as const) {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
      .expect(201);
  }
});

afterAll(async () => {
  await app?.close();
  // The order is the restriction: an account a row points at cannot be deleted underneath it.
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((user) => user.id);
  // The probe's own rows, and every row the auth routes filed for the accounts this spec
  // registered — sign-in and registration are writes like any other, and the restriction below
  // cannot tell the two sources apart.
  await prisma.actionLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { id: { in: rowIds } }] },
  });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

const probe = (path: string) => `/api/v1/_action-probe/${path}`;
const rowOf = (res: request.Response) =>
  prisma.actionLog.findFirstOrThrow({ where: { id: (res.body as { id: string }).id } });

describe('a write beside its own change', () => {
  it('names the caller the server resolved, and the request they sent', async () => {
    const token = await bearer('author');
    const res = await request(app.getHttpServer())
      .post(probe('record'))
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const row = await collect(rowOf(res));

    expect(row).toMatchObject({
      actionCode: 'course_published',
      // Neither of the next three was passed by the route: they are read off the action.
      sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
      targetTable: 'course',
      actorKind: 'user',
      actorUserId: await accountId('author'),
      actorRoleCode: ROLE_CODES.TEACHER,
      // The id the response echoed, so a row and the access-log line for that request are two views
      // of one event rather than two claims about it.
      requestId: res.headers['x-request-id'],
    });

    // Round-tripped through `jsonb` as written: a number stayed a number, and a reader asks for
    // these by name because the column keeps no key order.
    expect(row.detail).toEqual({ from: 'draft', to: 'published', priceAfter: 3900 });
  });

  it('records the role the account held then, not the one the token was minted with', async () => {
    // A promotion must not rewrite what the person did before it, and the log must not repeat the
    // token's claim: `JwtAuthGuard` reads the role off the row on every request, and this column
    // keeps the answer as it stood at the moment of the action.
    const id = await setRole('author', ROLE_CODES.OPS);
    const token = await bearer('author');

    const res = await request(app.getHttpServer())
      .post(probe('record'))
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const row = await collect(rowOf(res));

    expect(row).toMatchObject({ actorUserId: id, actorRoleCode: ROLE_CODES.OPS });

    await setRole('author', ROLE_CODES.TEACHER);
  });

  it('leaves nothing behind when the change it describes is rolled back', async () => {
    const targetId = randomUUID();
    const authorId = await accountId('author');

    // This is the ordinary shape of an unusual event: a write that decided something, then a later
    // statement in the same unit of work that refused it. A record filed after the commit — the way
    // a notification is usually sent — would still be here, describing a course nobody published.
    // The context is bound by hand because this is the one test here with no request behind it: the
    // actor is what the row needs, and the rollback is what the transaction is for.
    await expect(
      runWithLogContext(
        { requestId: `rolled-back-${RUN}`, userId: authorId, userRole: ROLE_CODES.TEACHER },
        () =>
          prisma.$transaction(async (tx) => {
            const row = await recorder.record(tx, {
              action: ACTION_CODES.COURSE_PUBLISHED,
              targetId,
            });
            throw new Error(`rolled back after recording ${row.id}`);
          }),
      ),
    ).rejects.toThrow('rolled back');

    expect(await prisma.actionLog.count({ where: { targetId } })).toBe(0);
  });

  it('attributes a person’s action to nobody when no request asked for it', async () => {
    // Outside a request there is no actor to read, and the honest-looking alternative is a row
    // saying *somebody archived this course and we do not know who* — filed at the moment a route
    // was wired up wrongly, and indistinguishable afterwards from one that was merely unlucky.
    await expect(
      prisma.$transaction((tx) =>
        recorder.record(tx, { action: ACTION_CODES.COURSE_ARCHIVED, targetId: SOME_COURSE }),
      ),
    ).rejects.toThrow(/no session|nobody/i);
    // Counted against the course this call named, not against the action code: suites run in
    // parallel forks over one database, and another suite archiving a course of its own is that
    // suite's record, not a row this refused write somehow left behind.
    expect(
      await prisma.actionLog.count({
        where: { targetId: SOME_COURSE, actionCode: 'course_archived' },
      }),
    ).toBe(0);
  });

  it('answers a scheduler’s action in full, with nobody credited and nothing to link', async () => {
    // The expiry sweep's row is written on a clock. The alternative — inventing an actor for the
    // process that happened to be running — would put a machine's work on a person's record.
    const row = await collect(
      prisma.$transaction((tx) =>
        recorder.record(tx, { action: ACTION_CODES.BOOKING_EXPIRED, targetId: randomUUID() }),
      ),
    );

    expect(row).toMatchObject({
      actionCode: 'booking_expired',
      actorKind: 'system',
      actorUserId: null,
      actorRoleCode: null,
      // Null rather than a synthetic id: the access log has no line for a cron either, and an id
      // that resolved to nothing would be a link to nowhere.
      requestId: null,
    });
  });
});

describe('a route that resolves a session without demanding one', () => {
  it('binds the caller a token offered, and has nobody to bind without one', async () => {
    const token = await bearer('reader');
    const withToken = await collect(
      request(app.getHttpServer())
        .post(probe('optional'))
        .set('Authorization', `Bearer ${token}`)
        .then(rowOf),
    );

    expect(withToken).toMatchObject({
      actionCode: 'enrollment_joined',
      // A student's own write: the section and the table came from the action, and the actor from a
      // token this route was allowed to go without.
      sectionCode: ACTION_SECTION_CODES.ENROLLMENT,
      targetTable: 'enrollment',
      actorUserId: await accountId('reader'),
      actorRoleCode: ROLE_CODES.STUDENT,
    });

    // The same route answered to a stranger. `@OptionalSession()` means the read still happens when
    // a token arrives; it does not mean a write gets an actor invented for it.
    const stranger = await request(app.getHttpServer()).post(probe('optional')).expect(500);
    expect(stranger.body).toMatchObject({ code: API_ERROR_CODES.INTERNAL_ERROR });
    expect(
      await prisma.actionLog.count({
        where: { actionCode: 'enrollment_joined', actorUserId: null },
      }),
    ).toBe(0);
  });
});

describe('the account section, which has no session to read', () => {
  it('binds the event to the account it is about, and to the request that carried it', async () => {
    const res = await request(app.getHttpServer()).post(probe('account?name=reader')).expect(201);
    const row = await collect(rowOf(res));

    expect(row).toMatchObject({
      actionCode: 'signed_in',
      sectionCode: ACTION_SECTION_CODES.ACCOUNT,
      // The account rather than a `refresh_token` row: the token is replaced on every portal load,
      // and the question asked later is what happened to this account.
      targetTable: 'users',
      targetId: await accountId('reader'),
      actorKind: 'user',
      actorUserId: await accountId('reader'),
      actorRoleCode: ROLE_CODES.STUDENT,
      requestId: res.headers['x-request-id'],
    });
  });

  it('refuses the same event when the route reaches for a session it does not have', async () => {
    const reader = await accountId('reader');
    const before = await prisma.actionLog.count({
      where: { actionCode: 'signed_in', actorUserId: reader },
    });

    const res = await request(app.getHttpServer())
      .post(probe('account-unbound?name=reader'))
      .expect(500);

    expect(res.body).toMatchObject({ code: API_ERROR_CODES.INTERNAL_ERROR });
    // The refusal is for the server and the log, not the client: what the recorder says names an
    // action and an internal state, and a sign-in form can do nothing with either.
    expect(res.body.message).not.toMatch(/signed_in|session/i);

    expect(
      await prisma.actionLog.count({ where: { actionCode: 'signed_in', actorUserId: reader } }),
    ).toBe(before);
  });
});

describe('what a row is filed under is decided by the action, not the caller', () => {
  it('gives four calls that named no section, table or actor four different answers', async () => {
    // All four went through one recorder against one table, and the only thing any of them named was
    // its action. A route that could choose its own section is a route that can decide where its own
    // writes get looked for, which is how a log ends up with a category nobody reads.
    const authorToken = await bearer('author');
    const readerToken = await bearer('reader');

    const sessionBound = await collect(
      request(app.getHttpServer())
        .post(probe('record'))
        .set('Authorization', `Bearer ${authorToken}`)
        .then(rowOf),
    );
    const student = await collect(
      request(app.getHttpServer())
        .post(probe('optional'))
        .set('Authorization', `Bearer ${readerToken}`)
        .then(rowOf),
    );
    const accountEvent = await collect(
      request(app.getHttpServer()).post(probe('account?name=reader')).then(rowOf),
    );
    const scheduler = await collect(
      prisma.$transaction((tx) =>
        recorder.record(tx, { action: ACTION_CODES.BOOKING_EXPIRED, targetId: randomUUID() }),
      ),
    );

    expect(
      [sessionBound, student, accountEvent, scheduler].map(
        (row) => `${row.sectionCode}/${row.targetTable}/${row.actorKind}`,
      ),
    ).toEqual([
      'course_authoring/course/user',
      'enrollment/enrollment/user',
      'account/users/user',
      'booking/booking/system',
    ]);
  });
});

describe('the actor stays bound through the rest of the request', () => {
  it('reaches a write several calls down without widening any signature', async () => {
    // The guard runs before the handler and `ActionRecorder` runs inside whatever the handler called,
    // so the binding has to survive the async chain rather than be threaded through every signature.
    // The probe above proves it arrives over HTTP; this proves the same store is what a service
    // reads, with a transaction opened where the work happens rather than where the request did.
    const authorId = await accountId('author');
    const row = await collect(
      runWithLogContext(
        { requestId: `nested-${RUN}`, userId: authorId, userRole: ROLE_CODES.OPS },
        () =>
          prisma.$transaction((tx) =>
            recorder.record(tx, { action: ACTION_CODES.COURSE_UPDATED, targetId: SOME_COURSE }),
          ),
      ),
    );

    expect(row).toMatchObject({
      actorUserId: authorId,
      actorRoleCode: ROLE_CODES.OPS,
      requestId: `nested-${RUN}`,
      sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
    });
  });
});
