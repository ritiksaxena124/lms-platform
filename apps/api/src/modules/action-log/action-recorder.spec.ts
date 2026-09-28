import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACTION_CODES, ACTION_SECTION_CODES, ROLE_CODES } from '@lms/shared';

import { runWithLogContext } from '../../common/logging/log-context';
import { ActionRecorder } from './action-recorder';

/**
 * The recorder's own rules, checked without a database: a row's shape comes from the action, its
 * actor comes from the request, and a person's action with no person in the request is refused
 * rather than filed.
 *
 * A fake transaction client is the whole harness, because the class deliberately has no Prisma
 * client of its own (6d's reason: the record is filed inside the transaction that made the change,
 * so the only client it may write through is the caller's). What the fake proves is the set of
 * columns the recorder is willing to write, and what it refuses to write.
 */
type CreateArgs = Prisma.ActionLogCreateArgs;

function fakeTx() {
  const writes: CreateArgs[] = [];
  const tx = {
    actionLog: {
      create: async (args: CreateArgs) => {
        writes.push(args);
        return { id: randomUUID() };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, writes };
}

/** The request as the middleware and `JwtAuthGuard` leave it for everything downstream. */
const inRequest = <T>(run: () => T): T =>
  runWithLogContext({ requestId: 'req-1', userId: 'user-1', userRole: ROLE_CODES.TEACHER }, run);

const recorder = new ActionRecorder();
const published = { action: ACTION_CODES.COURSE_PUBLISHED, targetId: 'course-1' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActionRecorder', () => {
  it('takes the section, the table and the kind of actor from the action', async () => {
    const { tx, writes } = fakeTx();

    await inRequest(() => recorder.record(tx, published));

    const data = writes[0]?.data as object;
    expect(data).toMatchObject({
      actionCode: 'course_published',
      sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
      targetTable: 'course',
      actorKind: 'user',
    });

    // An unknown action is refused here rather than written with an empty section, and the message
    // is `@lms/shared`'s: the vocabulary is the only place a made-up action can be caught, and this
    // is the one call every write makes into it.
    await expect(
      recorder.record(tx, { action: 'invented_by_a_test' as never, targetId: randomUUID() }),
    ).rejects.toThrow('invented_by_a_test');
  });

  it('reads the caller out of the request, not out of the caller', async () => {
    const { tx, writes } = fakeTx();

    // The signature has no actor parameter and no request id parameter. A route that could name
    // whoever it liked as the person who did it would put that route in charge of the answer the
    // log exists to give, and the `requestId` a client can send in a header would stop being a
    // correlation id and become a claim.
    await inRequest(() => recorder.record(tx, published));

    expect(writes[0]?.data as object).toMatchObject({
      actorUserId: 'user-1',
      actorRoleCode: ROLE_CODES.TEACHER,
      requestId: 'req-1',
    });
  });

  it('writes nine columns and nothing else', async () => {
    const { tx, writes } = fakeTx();

    await inRequest(() => recorder.record(tx, published));

    // No `status`, no `attempts`, no flag to retire the row: this is a ledger, and every key the
    // recorder passes is a fact about the action rather than a column the table would have to
    // default. `createdAt` and `id` are left to the database for the same reason.
    expect(Object.keys(writes[0]?.data as object).sort()).toEqual([
      'actionCode',
      'actorKind',
      'actorRoleCode',
      'actorUserId',
      'detail',
      'requestId',
      'sectionCode',
      'targetId',
      'targetTable',
    ]);
  });

  it('refuses a person’s action with nobody in the request', async () => {
    const { tx, writes } = fakeTx();

    // Outside any request there is no actor to read, and the honest-looking alternative is a row
    // with `actor_kind = user` and an empty actor — a log saying *we do not know who published this
    // course*, when what happened is that a route was wired up wrongly. A scheduler's action is the
    // only one allowed to have no actor, and that is decided by the shape rather than by the caller.
    await expect(recorder.record(tx, published)).rejects.toThrow(/no request|nobody/i);
    expect(writes).toHaveLength(0);
  });

  it('leaves a scheduler’s action nobody’s, even with a request in flight', async () => {
    const { tx, writes } = fakeTx();
    const expired = { action: ACTION_CODES.BOOKING_EXPIRED, targetId: 'booking-1' };

    // `booking_expired` is written by a sweep, and the sweep can be reached by a request as well as
    // by the clock (a manual run, a retried job). Crediting whoever happened to be waiting for it
    // would put an expiry on a teacher's record and make the row's own `actor_kind` a lie.
    await inRequest(() => recorder.record(tx, expired));

    expect(writes[0]?.data as object).toMatchObject({
      actionCode: 'booking_expired',
      actorKind: 'system',
      actorUserId: null,
      actorRoleCode: null,
    });
  });

  it('carries the request id when there is one, and nothing when there is not', async () => {
    const { tx, writes } = fakeTx();

    await inRequest(() => recorder.record(tx, published));
    await recorder.record(tx, {
      action: ACTION_CODES.BOOKING_EXPIRED,
      targetId: 'booking-2',
    });

    // A cron's row has no request to point back at. Null rather than a synthetic id: the access log
    // has no line for it either, and an id that resolved to nothing would be a link to nowhere.
    expect(writes.map((write) => (write.data as { requestId?: string }).requestId)).toEqual([
      'req-1',
      null,
    ]);
  });

  it('names an account that has not signed in yet', async () => {
    const { tx, writes } = fakeTx();
    const accountId = 'user-2';

    // The four account events are the person-actions with no session to read: on `/auth/login`
    // nobody is signed in yet, and the guard has already returned for a public route. So the
    // caller names the account — which is the same account the row is about, and `7c-3` passes it
    // twice for that reason.
    await recorder.recordAs({ userId: accountId, userRole: ROLE_CODES.STUDENT }, tx, {
      action: ACTION_CODES.SIGNED_IN,
      targetId: accountId,
    });

    expect(writes[0]?.data as object).toMatchObject({
      actionCode: 'signed_in',
      sectionCode: ACTION_SECTION_CODES.ACCOUNT,
      targetTable: 'users',
      actorUserId: accountId,
      actorRoleCode: ROLE_CODES.STUDENT,
      requestId: null,
    });
  });

  it('will not let the named-actor door be used for anything else', async () => {
    const { tx, writes } = fakeTx();

    // Only the account section has no session behind it. Everywhere else, `recordAs` would be a way
    // for one route to file an action against a person who was never asking — which is the exact
    // failure the actor column exists to make impossible.
    await expect(
      recorder.recordAs({ userId: 'somebody-else', userRole: ROLE_CODES.STUDENT }, tx, published),
    ).rejects.toThrow(/account/);
    expect(writes).toHaveLength(0);
  });

  it('files the decided facts, and an empty set when nothing was decided', async () => {
    const { tx, writes } = fakeTx();

    await inRequest(() =>
      recorder.record(tx, {
        ...published,
        detail: { priceBefore: 4900, priceAfter: 3900, publishedNow: true },
      }),
    );
    await inRequest(() => recorder.record(tx, published));

    expect((writes[0]?.data as { detail: object }).detail).toEqual({
      priceBefore: 4900,
      priceAfter: 3900,
      publishedNow: true,
    });
    // `{}` rather than null: a reader should see an empty set of facts rather than have to decide
    // what the absence of one means, and the column's own default is `{}` for the same reason.
    expect((writes[1]?.data as { detail: object }).detail).toEqual({});
  });
});
