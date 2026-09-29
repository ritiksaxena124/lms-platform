import type { INestApplication } from '@nestjs/common';
import type { ActionLog } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACCOUNT_STATUS_CODES,
  ACTION_SECTION_CODES,
  ACTION_TARGET_TABLE_CODES,
  LKP_TYPE_CODES,
} from '@lms/shared';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The four account events, filed through the one door that lets a caller name its actor.
 *
 * Every other record in this log reads its actor out of the request, because `x-request-id` and the
 * bearer token are things a client says about itself and the answer the log exists to give — *who*
 * did this — cannot be left to the caller that is asking. These four are the exception, and this
 * file is where the exception is held to its size: `/auth/register` has no account until its own
 * write makes one, `/auth/login` has nobody signed in yet, and `/auth/logout` authenticates from a
 * cookie the guard never resolves. All four are `@Public()`, so nothing is in the request to read.
 *
 * What that leaves to prove is that `recordAs` files the *account* rather than the session, and does
 * it only where a write actually happened. So the claims below are mostly negatives — a wrong
 * password, a disabled account, a rotation and a second sign-out of a token that was already retired
 * all file nothing — because the four positives are only worth reading if the ordinary noise of
 * signing in and out does not fill the table.
 *
 * The one number filed anywhere here is how many sessions a replayed token ended. It is the whole
 * reason that event is in the log rather than only in the access log: the token rows say each of
 * them stopped, and nothing says they stopped together, on the strength of one being seen twice.
 *
 * Nothing here contains an address, a password or a token, and the last test says so about the rows
 * themselves rather than leaving it to whoever reads this file.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const REFRESH_COOKIE = 'lms_refresh';

let app: INestApplication;
const prisma: PrismaClient = new PrismaClient();

const created: string[] = [];

const filedBy = (requestId: string): Promise<ActionLog[]> =>
  prisma.actionLog.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });

/** Everything filed about one account. The account rather than a `refresh_token` row is what the
 * vocabulary says these events are about, so the id a person asks about is the one to look up by. */
const rowsAbout = (userId: string): Promise<ActionLog[]> =>
  prisma.actionLog.findMany({ where: { targetId: userId }, orderBy: { createdAt: 'asc' } });

function rawCookie(res: request.Response): string | undefined {
  const entries = (res.headers['set-cookie'] ?? []) as string[];
  return entries.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))?.split(';')[0];
}

/** One press on an auth route — which needs no bearer token, since every route here is public — and
 * the rows it filed. */
async function press(
  path: 'register' | 'login' | 'refresh' | 'logout',
  body?: object,
  cookie?: string,
): Promise<{ res: request.Response; rows: ActionLog[] }> {
  const call = request(app.getHttpServer()).post(`/api/v1/auth/${path}`);
  const res = await (cookie ? call.set('Cookie', cookie) : body ? call.send(body) : call).expect(
    (response) => {
      if (response.status < 200 || response.status > 299) {
        throw new Error(
          `POST /auth/${path} answered ${response.status}: ${JSON.stringify(response.body)}`,
        );
      }
    },
  );
  return { res, rows: await filedBy(res.headers['x-request-id'] as string) };
}

/** A press that was refused, and the rows it filed — the claim being that it filed none. The status
 * is checked rather than thrown on, because a refused write is the whole point of the press. */
async function refused(
  status: number,
  path: 'register' | 'login' | 'refresh' | 'logout',
  body?: object,
  cookie?: string,
): Promise<ActionLog[]> {
  const call = request(app.getHttpServer()).post(`/api/v1/auth/${path}`);
  const res = await (cookie ? call.set('Cookie', cookie) : body ? call.send(body) : call).expect(
    status,
  );
  return filedBy(res.headers['x-request-id'] as string);
}

async function register(name: string, role: 'teacher' | 'student' | 'ops'): Promise<string> {
  const { res } = await press('register', {
    email: emailFor(name),
    password: PASSWORD,
    fullName: `${name} Person`,
    role,
  });
  const id = res.body.user.id as string;
  created.push(id);
  return id;
}

/** A signed-in account, and its live session as the cookie the portal would keep it in. */
async function signIn(email: string): Promise<string> {
  const { res } = await press('login', { email, password: PASSWORD });
  const cookie = rawCookie(res);
  if (!cookie) throw new Error('The sign-in set no session cookie.');
  return cookie;
}

const shape = (row: ActionLog) => `${row.sectionCode}/${row.targetTable}/${row.actorKind}`;

function onlyRow(rows: ActionLog[]): ActionLog {
  const [row] = rows;
  if (!row || rows.length !== 1) {
    throw new Error(`Expected exactly one record, got: ${JSON.stringify(rows)}`);
  }
  return row;
}

const codes = (rows: ActionLog[]) => rows.map((row) => row.actionCode);

async function statusId(code: string): Promise<string> {
  const value = await prisma.lkpValue.findFirstOrThrow({
    where: { code, type: { code: LKP_TYPE_CODES.ACCOUNT_STATUS } },
  });
  return value.id;
}

const liveSessions = (userId: string): Promise<number> =>
  prisma.refreshToken.count({ where: { userId, revokedAt: null } });

beforeAll(async () => {
  await seedLookups(prisma);
  app = await createTestApp({ imports: [AppModule] });
});

afterAll(async () => {
  await app?.close();

  // The record of an account outlives the account by design — `actor_user_id` is `Restrict` — so a
  // fixture that wants its user gone has to take the ledger's rows for that account first.
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: created } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe('an account being opened', () => {
  it('files the registration against the account the write just made', async () => {
    const { res, rows } = await press('register', {
      email: emailFor('amy'),
      password: PASSWORD,
      fullName: 'Amy Person',
      role: 'student',
    });
    const account = res.body.user.id as string;
    created.push(account);

    const row = onlyRow(rows);
    expect(row).toMatchObject({
      actionCode: 'account_registered',
      sectionCode: ACTION_SECTION_CODES.ACCOUNT,
      targetTable: ACTION_TARGET_TABLE_CODES.USERS,
      targetId: account,
      actorKind: 'user',
      // Named twice, and deliberately: this is the one section where the account the action is about
      // and the person who did it are the same row, because nobody else could have.
      actorUserId: account,
      actorRoleCode: 'student',
      requestId: res.headers['x-request-id'],
    });
    expect(shape(row)).toBe('account/users/user');
    // The role, the status, the address and the day are all columns of the row the insert wrote, and
    // the digest is not a fact anybody should be able to read out of a ledger.
    expect(row.detail).toEqual({});
  });

  it('files nothing for an address that already has an account', async () => {
    const first = await register('ben', 'teacher');

    // The unique address is refused inside the same write that would have filed the record, so the
    // rollback takes the record with it — a log of accounts that were not made is a directory.
    expect(
      await refused(409, 'register', {
        email: emailFor('ben'),
        password: PASSWORD,
        fullName: 'Ben Other',
        role: 'teacher',
      }),
    ).toEqual([]);
    expect(codes(await rowsAbout(first))).toEqual(['account_registered']);
  });

  it('keeps an address, a password and a token out of every row it files', async () => {
    const account = await register('carla', 'student');
    const cookie = await signIn(emailFor('carla'));
    await press('logout', undefined, cookie);

    const written = JSON.stringify(await rowsAbout(account));

    expect(written).not.toContain(emailFor('carla'));
    expect(written).not.toContain(PASSWORD);
    // The session cookie is the credential: a log row that carried it would be a way to sign in
    // again with, and a hash is no better to have here than the thing itself.
    expect(written).not.toContain(cookie.split('=')[1]!);
    expect(written).not.toMatch(/sha256|bcrypt|\$[0-9]\$|https?:/);
  });
});

describe('an account being used', () => {
  let account = '';

  beforeAll(async () => {
    account = await register('dan', 'teacher');
  });

  it('files each sign-in as its own record, including the second one', async () => {
    const first = await press('login', { email: emailFor('dan'), password: PASSWORD });
    const second = await press('login', { email: emailFor('dan'), password: PASSWORD });

    const row = onlyRow(first.rows);
    expect(row).toMatchObject({
      actionCode: 'signed_in',
      sectionCode: ACTION_SECTION_CODES.ACCOUNT,
      targetTable: ACTION_TARGET_TABLE_CODES.USERS,
      targetId: account,
      actorKind: 'user',
      actorUserId: account,
      actorRoleCode: 'teacher',
    });
    expect(shape(row)).toBe('account/users/user');
    expect(row.detail).toEqual({});

    // Signing in twice is two events, not one replayed: the write that earns the row moved
    // `lastLoginAt`, and "when was this account last used" is only answerable if every use is there.
    expect(onlyRow(second.rows).actionCode).toBe('signed_in');
    expect(codes(await rowsAbout(account))).toEqual([
      'account_registered',
      'signed_in',
      'signed_in',
    ]);
  });

  it('files nothing for the sign-ins that were refused', async () => {
    const before = await rowsAbout(account);
    const activeId = await statusId(ACCOUNT_STATUS_CODES.ACTIVE);

    // A wrong password and a disabled account each answer a person, and neither touched a row: the
    // access log already has the request, and this table is a record of changes.
    expect(
      await refused(401, 'login', {
        email: emailFor('dan'),
        password: 'a wrong password entirely',
      }),
    ).toEqual([]);

    await prisma.user.update({
      where: { id: account },
      data: { statusValueId: await statusId(ACCOUNT_STATUS_CODES.DISABLED) },
    });
    expect(await refused(403, 'login', { email: emailFor('dan'), password: PASSWORD })).toEqual([]);
    await prisma.user.update({ where: { id: account }, data: { statusValueId: activeId } });

    expect(await rowsAbout(account)).toEqual(before);
  });

  it('files the sign-out, and not the second one of the same session', async () => {
    const cookie = await signIn(emailFor('dan'));

    const out = await press('logout', undefined, cookie);
    const row = onlyRow(out.rows);
    expect(row).toMatchObject({
      actionCode: 'signed_out',
      targetId: account,
      actorUserId: account,
      actorRoleCode: 'teacher',
    });
    // Which token was presented is a `refresh_token` row's business, and the answer to "when did
    // they stop using this account" is the instant on this record.
    expect(row.detail).toEqual({});

    // Logout is idempotent by design, so the second press changes nothing — and a ledger that says a
    // person signed out twice is a ledger saying something happened that did not.
    expect(await press('logout', undefined, cookie)).toMatchObject({ rows: [] });
  });

  it('leaves a rotation unrecorded, because every portal load would file one', async () => {
    const cookie = await signIn(emailFor('dan'));
    const before = await rowsAbout(account);

    // Rotating a live session is a new token row and the retirement of the old one. Neither is a
    // decision about the account, and the vocabulary says so: the record of a session lives in
    // `refresh_token`, which is why this press answers 200 and files nothing.
    expect(await press('refresh', undefined, cookie)).toMatchObject({ rows: [] });
    expect(await rowsAbout(account)).toEqual(before);
  });

  it('files the replay with the sessions it ended, and the next one with none', async () => {
    // Its own account, because the number this record files is how many sessions the finding ended,
    // and a shared one would have the earlier presses in it.
    const someone = await register('zoe', 'student');
    const stolen = await signIn(emailFor('zoe'));
    // The real device rotating its own session is not news about the account, so the press that
    // makes the copy detectable files nothing itself — and leaves exactly one session live.
    expect(await press('refresh', undefined, stolen)).toMatchObject({ rows: [] });
    expect(await liveSessions(someone)).toBe(1);

    const replay = await refused(401, 'refresh', undefined, stolen);

    const row = onlyRow(replay);
    expect(row).toMatchObject({
      actionCode: 'session_replay_detected',
      sectionCode: ACTION_SECTION_CODES.ACCOUNT,
      targetTable: ACTION_TARGET_TABLE_CODES.USERS,
      targetId: someone,
      actorKind: 'user',
      actorUserId: someone,
      actorRoleCode: 'student',
      // A person pressed this, with a cookie rather than a token: the request id is theirs even
      // though the guard never resolved them.
      requestId: expect.any(String),
    });
    // The one number in this section, and the reason the event is here rather than only in the
    // access log: the token rows each say they stopped, and nothing else says they stopped together.
    expect(row.detail).toEqual({ revokedSessions: 1 });
    expect(await liveSessions(someone)).toBe(0);

    // Presented again, the finding is real and there is nothing left to end — so the write changes no
    // row and files no record, and the account's history stays as the first replay left it.
    expect(await refused(401, 'refresh', undefined, stolen)).toEqual([]);
    expect(codes(await rowsAbout(someone))).toEqual([
      'account_registered',
      'signed_in',
      'session_replay_detected',
    ]);
  });
});
