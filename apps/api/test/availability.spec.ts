import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A teacher's weekly availability: the windows they keep open for classes.
 *
 * `availability-schema.spec.ts` proved what the table does not decide — a window that ends
 * before it starts is a row Postgres will happily hold. This is where that decision lives, and
 * three things shape the answers below.
 *
 * A rule is a wall-clock shape, not an instant. `09:00–10:30 on a Monday` is stored as minutes
 * from local midnight in the teacher's own zone, so nothing here reads a timezone or converts
 * anything: the same two numbers are two different classes in two different cities, and both
 * teachers are right. The instants arrive in 4e, when a slot is generated inside a window.
 *
 * Overlap is refused here rather than at the person booking. A teacher with two windows over the
 * same hour would be offering one class twice, and the grid would hand a student two slots to
 * choose between for the same forty-five minutes.
 *
 * Retirement is the only way a window leaves. The row stays — §2 — because the bookings already
 * made inside it point at it, and a business key unique among all rows means a window opened
 * again at the same minute is that row, not a competing twin.
 *
 * Accounts are expensive here: registration is throttled at twenty a minute, so a teacher per
 * test would spend the whole budget on the first four. The week is cleaned between tests instead
 * — the rows go, the accounts stay — and every test below asserts on the schedule it wrote.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

/** The response's own shape, so a list can be read without casting at every assertion. */
interface Row {
  id: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
}

let app: INestApplication;
const prisma = new PrismaClient();

/** Register and sign in: the token is what carries an account into every route. */
async function tokenFor(name: string, role: string): Promise<string> {
  const registered = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
    .expect(201);
  if (!registered.body) throw new Error('registration is required');
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

async function accountId(name: string): Promise<string> {
  const row = await prisma.user.findUnique({
    where: { email: emailFor(name) },
    select: { id: true },
  });
  if (!row) throw new Error(`no account for ${name}`);
  return row.id;
}

/** A window, in the units the table stores: a weekday and wall-clock minutes. The default is one
 * Monday hour with thirty-minute classes; each test moves the one thing it is about. */
function windowFor(overrides: Record<string, unknown> = {}) {
  return { weekday: 1, startMinutes: 540, endMinutes: 600, slotMinutes: 30, ...overrides };
}

function listRules(token: string | undefined): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/availability/rules');
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

function createRule(token: string | undefined, body: Record<string, unknown>): request.Test {
  const call = request(app.getHttpServer()).post('/api/v1/availability/rules').send(body);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

function updateRule(
  token: string | undefined,
  id: string,
  body: Record<string, unknown>,
): request.Test {
  const call = request(app.getHttpServer()).patch(`/api/v1/availability/rules/${id}`).send(body);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

function retireRule(token: string | undefined, id: string): request.Test {
  const call = request(app.getHttpServer()).post(`/api/v1/availability/rules/${id}/retire`).send();
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function created(token: string, body: Record<string, unknown>): Promise<string> {
  const res = await createRule(token, body).expect(201);
  return res.body.rule.id as string;
}

async function listed(token: string): Promise<Row[]> {
  const res = await listRules(token).expect(200);
  return res.body.items as Row[];
}

/** `weekday@opening minute` — short enough to read a whole week in one assertion. */
function at(rules: Row[]): string[] {
  return rules.map((rule) => `${rule.weekday}@${rule.startMinutes}`);
}

/** The parts of a failure that must match. `requestId` and `timestamp` are per request, and
 * comparing them would make this "these two are the same answer" check fail for the wrong
 * reason — two requests cannot share an instant. */
function failureShape(body: Record<string, unknown>) {
  return { statusCode: body.statusCode, code: body.code, message: body.message };
}

function validation(body: Record<string, unknown>): Record<string, string[]> {
  return (body.details as { validation: Record<string, string[]> }).validation;
}

describe("a teacher's weekly availability", () => {
  let teacher: string;
  let colleague: string;
  let student: string;
  let teacherIds: string[] = [];

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    teacher = await tokenFor('avai', 'teacher');
    colleague = await tokenFor('avel', 'teacher');
    student = await tokenFor('avst', 'student');
    teacherIds = [await accountId('avai'), await accountId('avel')];
  });

  afterEach(async () => {
    // The rows, not the accounts. Each test asserts on the one week it wrote, and the business
    // key is unique among retired rows too, so a leftover would be a collision the next test
    // did not cause.
    await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: teacherIds } } });
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('records a window and lists it back for the teacher who set it', async () => {
    const res = await createRule(teacher, windowFor({ weekday: 2 })).expect(201);

    expect(res.body.rule).toMatchObject({
      weekday: 2,
      startMinutes: 540,
      endMinutes: 600,
      slotMinutes: 30,
    });
    expect(at(await listed(teacher))).toEqual(['2@540']);
  });

  it('has nothing to show a teacher who has set no windows', async () => {
    expect(await listed(colleague)).toEqual([]);
  });

  it('orders the week by day and then by the minute each window opens', async () => {
    await created(teacher, windowFor({ weekday: 5, startMinutes: 540, endMinutes: 600 }));
    await created(teacher, windowFor({ weekday: 4, startMinutes: 660, endMinutes: 720 }));
    await created(teacher, windowFor({ weekday: 4, startMinutes: 600, endMinutes: 630 }));

    expect(at(await listed(teacher))).toEqual(['4@600', '4@660', '5@540']);
  });

  it('names a window by its minutes and nothing else', async () => {
    const res = await createRule(teacher, windowFor()).expect(201);

    expect(Object.keys(res.body.rule).sort()).toEqual([
      'createdAt',
      'endMinutes',
      'id',
      'slotMinutes',
      'startMinutes',
      'updatedAt',
      'weekday',
    ]);
    // No timezone travels with a rule: the minutes are already local, and the zone belongs to
    // the account that wrote them.
    expect(JSON.stringify(res.body)).not.toMatch(/Asia\/|America\/|Europe\/|"timezone"/);
  });

  it('refuses a window that ends before it starts', async () => {
    const res = await createRule(teacher, windowFor({ startMinutes: 900, endMinutes: 600 })).expect(
      400,
    );

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(validation(res.body).endMinutes).toBeDefined();
    expect(await listed(teacher)).toEqual([]);
  });

  it('refuses a window of no length at all', async () => {
    await createRule(teacher, windowFor({ startMinutes: 600, endMinutes: 600 })).expect(400);
  });

  it('refuses a slot longer than the window holding it', async () => {
    const res = await createRule(teacher, windowFor({ slotMinutes: 90 })).expect(400);

    expect(validation(res.body).slotMinutes).toBeDefined();
  });

  it('refuses a weekday outside the seven', async () => {
    await createRule(teacher, windowFor({ weekday: 0 })).expect(400);
    await createRule(teacher, windowFor({ weekday: 8 })).expect(400);
    await createRule(teacher, windowFor({ weekday: 1.5 })).expect(400);
    expect(await listed(teacher)).toEqual([]);
  });

  it('refuses a window that is missing one of its four parts', async () => {
    const { slotMinutes: _omitted, ...withoutSlot } = windowFor();

    await createRule(teacher, withoutSlot).expect(400);
  });

  it('refuses a second window that overlaps one already standing', async () => {
    await created(teacher, windowFor({ startMinutes: 540, endMinutes: 630 }));

    const res = await createRule(teacher, windowFor({ startMinutes: 600, endMinutes: 660 })).expect(
      409,
    );

    expect(res.body.code).toBe('CONFLICT');
    // The teacher is told which window is in the way, in the units they set it in.
    expect(JSON.stringify(res.body)).toContain('Monday 09:00');
    expect(at(await listed(teacher))).toEqual(['1@540']);
  });

  it('allows a window that opens the minute another one closes', async () => {
    await created(teacher, windowFor({ startMinutes: 540, endMinutes: 600 }));

    await createRule(teacher, windowFor({ startMinutes: 600, endMinutes: 660 })).expect(201);
    expect(at(await listed(teacher))).toEqual(['1@540', '1@600']);
  });

  it('keeps the same hours on a different weekday', async () => {
    await created(teacher, windowFor({ weekday: 1 }));

    await createRule(teacher, windowFor({ weekday: 2 })).expect(201);
  });

  it("does not let one teacher's hours block another's, or show in their list", async () => {
    await created(teacher, windowFor({ startMinutes: 540, endMinutes: 630, slotMinutes: 45 }));

    await createRule(colleague, windowFor({ startMinutes: 540, endMinutes: 600 })).expect(201);

    expect(at(await listed(colleague))).toEqual(['1@540']);
    expect(at(await listed(teacher))).toEqual(['1@540']);
  });

  it('changes a window, and does not treat its own hours as an overlap', async () => {
    const morning = await created(teacher, windowFor({ startMinutes: 540, endMinutes: 600 }));
    await created(teacher, windowFor({ startMinutes: 660, endMinutes: 720 }));

    // The same hours back again are a save that changed nothing, not a collision with itself.
    const unchanged = await updateRule(teacher, morning, {
      startMinutes: 540,
      endMinutes: 600,
    }).expect(200);
    expect(unchanged.body.rule).toMatchObject({ id: morning, startMinutes: 540, endMinutes: 600 });

    const moved = await updateRule(teacher, morning, {
      startMinutes: 600,
      endMinutes: 660,
    }).expect(200);
    expect(moved.body.rule).toMatchObject({ id: morning, startMinutes: 600, endMinutes: 660 });
    expect(at(await listed(teacher))).toEqual(['1@600', '1@660']);
  });

  it('refuses an update that would drop a window onto another one', async () => {
    await created(teacher, windowFor({ startMinutes: 540, endMinutes: 600 }));
    const afternoon = await created(teacher, windowFor({ startMinutes: 660, endMinutes: 720 }));

    const res = await updateRule(teacher, afternoon, {
      startMinutes: 570,
      endMinutes: 630,
    }).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    // The refused edit left nothing behind.
    expect(at(await listed(teacher))).toEqual(['1@540', '1@660']);
  });

  it('refuses an update that breaks the window it is changing', async () => {
    const morning = await created(teacher, windowFor({ startMinutes: 540, endMinutes: 600 }));

    const tooLate = await updateRule(teacher, morning, { endMinutes: 480 }).expect(400);
    expect(validation(tooLate.body).endMinutes).toBeDefined();

    const tooLong = await updateRule(teacher, morning, { slotMinutes: 120 }).expect(400);
    expect(validation(tooLong.body).slotMinutes).toBeDefined();

    // A day moved is a day moved, and it still carries the same hours.
    const day = await updateRule(teacher, morning, { weekday: 3 }).expect(200);
    expect(day.body.rule).toMatchObject({ weekday: 3, startMinutes: 540, endMinutes: 600 });
  });

  it('retires a window and takes it out of the list', async () => {
    const id = await created(teacher, windowFor({ startMinutes: 1080, endMinutes: 1140 }));

    const res = await retireRule(teacher, id).expect(200);
    expect(res.body.rule).toMatchObject({ id });

    expect(await listed(teacher)).toEqual([]);
    // Retired, not erased: the row is what a booking made inside it points at.
    const row = await prisma.availabilityRule.findUnique({ where: { id } });
    expect(row?.isActive).toBe(false);
  });

  it('refuses to retire a window that is already retired', async () => {
    const id = await created(teacher, windowFor({ startMinutes: 1140, endMinutes: 1200 }));
    await retireRule(teacher, id).expect(200);

    const res = await retireRule(teacher, id).expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('opens a retired window again rather than starting a competing twin', async () => {
    const id = await created(teacher, windowFor({ startMinutes: 1200, endMinutes: 1260 }));
    const before = await prisma.availabilityRule.findUniqueOrThrow({ where: { id } });
    await retireRule(teacher, id).expect(200);

    const res = await createRule(
      teacher,
      windowFor({ startMinutes: 1200, endMinutes: 1320, slotMinutes: 60 }),
    ).expect(201);

    // The same row with the new hours written on it: one window per opening minute, and the day
    // it was first set stays where it was (§2, and why the business key is unique among retired
    // rows as well as live ones).
    expect(res.body.rule).toMatchObject({
      id,
      startMinutes: 1200,
      endMinutes: 1320,
      slotMinutes: 60,
    });
    expect(new Date(res.body.rule.createdAt as string).getTime()).toBe(before.createdAt.getTime());
    expect(at(await listed(teacher))).toEqual(['1@1200']);
  });

  it('takes a retired window out of the way of a new one', async () => {
    const id = await created(teacher, windowFor({ startMinutes: 540, endMinutes: 600 }));
    await retireRule(teacher, id).expect(200);

    // A different opening minute is a different slice of the week, so retirement really did
    // free the hour rather than merely hiding the row.
    await createRule(teacher, windowFor({ startMinutes: 600, endMinutes: 660 })).expect(201);
    expect(at(await listed(teacher))).toEqual(['1@600']);
  });

  it('holds retirement out of the edit form', async () => {
    const id = await created(teacher, windowFor({ startMinutes: 1260, endMinutes: 1320 }));

    await updateRule(teacher, id, { isActive: false }).expect(400);
    expect(at(await listed(teacher))).toEqual(['1@1260']);
  });

  it('will not take a teacher from the body', async () => {
    await createRule(teacher, {
      ...windowFor({ startMinutes: 1260, endMinutes: 1320 }),
      teacherUserId: teacherIds[1],
    }).expect(400);

    expect(await listed(colleague)).toEqual([]);
  });

  it("answers another teacher's window exactly like one that was never written", async () => {
    const id = await created(teacher, windowFor({ startMinutes: 1320, endMinutes: 1380 }));

    const someoneElses = await updateRule(colleague, id, { startMinutes: 1200 }).expect(404);
    const neverWritten = await updateRule(colleague, randomUUID(), {
      startMinutes: 1200,
    }).expect(404);
    const retired = await retireRule(colleague, id).expect(404);

    expect(someoneElses.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(failureShape(someoneElses.body)).toEqual(failureShape(neverWritten.body));
    expect(failureShape(retired.body)).toEqual(failureShape(neverWritten.body));
    // And the window is where it was.
    expect(at(await listed(teacher))).toEqual(['1@1320']);
  });

  it('finds no window in an address that cannot hold one', async () => {
    const neverWritten = await updateRule(teacher, randomUUID(), {
      startMinutes: 600,
    }).expect(404);

    const malformed = await updateRule(teacher, 'not-a-uuid', { startMinutes: 600 }).expect(404);
    expect(failureShape(malformed.body)).toEqual(failureShape(neverWritten.body));

    const notRetirable = await retireRule(teacher, 'not-a-uuid').expect(404);
    expect(failureShape(notRetirable.body)).toEqual(failureShape(neverWritten.body));
  });

  it('refuses a student at the door', async () => {
    await listRules(student).expect(403);
    await createRule(student, windowFor()).expect(403);
  });

  it('refuses a caller with no session at all', async () => {
    await listRules(undefined).expect(401);
    await createRule(undefined, windowFor()).expect(401);
  });
});
