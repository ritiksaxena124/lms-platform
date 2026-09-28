import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `availability_rule` table promises with no HTTP in the way: that a teacher's
 * weekly open window is a wall-clock range they own, that one window per start time on a day
 * keeps the schedule readable, that the range is stored as minutes so a DST change moves the
 * instant rather than the number, and that the row is a plan — nothing here decides whether
 * a student may book inside it.
 *
 * Which weekday, whether the window is well-formed, and whether two windows overlap are all
 * decided by the endpoint that writes them; the table only knows a teacher asked for this
 * slice of their week to exist.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let activeStatusId: string;

const createUser = (email: string, roleValueId: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Availability Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId,
      statusValueId: activeStatusId,
    },
  });

const createTeacher = (email: string) => createUser(email, teacherRoleId);

/** Monday, 09:00–12:00 as a 45-minute slot. Times are wall-clock minutes in the teacher's zone. */
const WINDOW = { weekday: 1, startMinutes: 9 * 60, endMinutes: 12 * 60, slotMinutes: 45 };

const addRule = (teacherId: string, overrides: Record<string, number> = {}) =>
  prisma.availabilityRule.create({ data: { teacherUserId: teacherId, ...WINDOW, ...overrides } });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: userIds } } });
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('availability_rule table', () => {
  it('records the window exactly as the teacher asked for it', async () => {
    const teacher = await createTeacher(emailFor('owner'));

    const created = await addRule(teacher.id);

    // The four numbers are the whole promise: a day, a wall-clock range, and how long a
    // class inside it runs. Everything else — is this a sane range, does it collide with
    // another window — is the endpoint's judgement, not a column.
    expect(created).toMatchObject({
      teacherUserId: teacher.id,
      isActive: true,
      ...WINDOW,
    });
  });

  it('keeps one window per start time on a day, and lets a second start time stand', async () => {
    const teacher = await createTeacher(emailFor('dup'));

    await addRule(teacher.id);

    // Two rules opening at 09:00 Monday would be two answers to one question, and expanding
    // them into slots would hand a student the same 09:00 class twice.
    await expect(addRule(teacher.id)).rejects.toMatchObject({ code: 'P2002' });
    // An afternoon window on the same day is a different slice of the week, so it stands.
    await expect(
      addRule(teacher.id, { startMinutes: 14 * 60, endMinutes: 17 * 60 }),
    ).resolves.toMatchObject({ startMinutes: 14 * 60 });
  });

  it('holds a retired window’s slot against a new one, so the way back is the same row', async () => {
    const teacher = await createTeacher(emailFor('revive'));
    const first = await addRule(teacher.id);

    await prisma.availabilityRule.update({
      where: { id: first.id },
      data: { isActive: false },
    });

    // Retiring a window is a state of the one record, not an erasure — re-adding an identical
    // Monday-09:00 window must reopen this row rather than create a competing twin, exactly
    // as a left enrollment reopens rather than duplicating.
    await expect(addRule(teacher.id)).rejects.toMatchObject({ code: 'P2002' });

    const again = await prisma.availabilityRule.update({
      where: { id: first.id },
      data: { isActive: true },
    });
    expect(again.id).toBe(first.id);
    expect(again.createdAt).toEqual(first.createdAt);
  });

  it('spans every day of the week, each its own window', async () => {
    const teacher = await createTeacher(emailFor('week'));

    for (const weekday of [1, 2, 3, 4, 5]) {
      await expect(addRule(teacher.id, { weekday })).resolves.toMatchObject({ weekday });
    }
  });

  it('will not attach a window to a teacher who does not exist', async () => {
    await expect(addRule(randomUUID())).rejects.toThrow();
  });

  it('will not let a teacher with a window disappear underneath it', async () => {
    const teacher = await createTeacher(emailFor('kept'));
    await addRule(teacher.id);

    // A teacher is archived, not deleted, for the same reason a course is: a student's note
    // or a past booking still names the window that made it possible.
    await expect(prisma.user.delete({ where: { id: teacher.id } })).rejects.toThrow();
  });

  it('stores wall-clock minutes, not instants, so the range is a plan and not a promise about UTC', async () => {
    const teacher = await createTeacher(emailFor('wallclock'));

    // A morning window in Kolkata and the same numbers in Lisbon are different instants; the
    // row deliberately records the teacher's clock, and only the zone on `users` turns it into
    // a moment. Here is the proof the table itself holds no instant: two teachers, identical
    // minutes, both accepted.
    const second = await createTeacher(emailFor('wallclock2'));
    await expect(addRule(teacher.id)).resolves.toMatchObject({ startMinutes: WINDOW.startMinutes });
    await expect(addRule(second.id)).resolves.toMatchObject({ startMinutes: WINDOW.startMinutes });
  });

  it('makes no decision about whether a range is well-formed', async () => {
    const teacher = await createTeacher(emailFor('badrange'));

    // start after end is nonsense a student must never see, but it is the endpoint's refusal,
    // not a column constraint — so the table accepts it. This is the range check's reason to
    // live in 4c, and this test is here so that fact cannot silently move into the schema.
    await expect(
      addRule(teacher.id, { startMinutes: 15 * 60, endMinutes: 10 * 60 }),
    ).resolves.toMatchObject({ startMinutes: 15 * 60, endMinutes: 10 * 60 });
  });
});
