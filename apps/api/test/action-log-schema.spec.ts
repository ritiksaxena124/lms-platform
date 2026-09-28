import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACTION_ACTOR_KIND_CODES,
  ACTION_CODES,
  ACTION_SECTION_CODES,
  ACTION_TARGET_TABLE_CODES,
  LKP_TYPE_CODES,
  ROLE_CODES,
} from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `action_log` table promises with no recorder in the way: that a row names who did
 * something, what they did, which row it was done to and which part of the app it happened in — and
 * that it is a row that can never be changed afterwards.
 *
 * Which actions exist, which section each one belongs to, which table it is about and whether a
 * person or the scheduler did it are all vocabulary in `@lms/shared` (Phase 7a), and the reason this
 * table accepts any string in those columns is the reason `mail_outbox` does: a constraint here would
 * be a second, weaker copy of a list that already lives next to the code that writes it. What is
 * worth pinning at this level is the shape — the columns that exist, the ones that must not, and
 * which references are real.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let studentRoleId: string;
let activeStatusId: string;

const createPerson = (name: string, roleValueId: string) =>
  prisma.user.create({
    data: {
      email: emailFor(name),
      passwordHash: 'scrypt$placeholder',
      fullName: 'Action Log Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId,
      statusValueId: activeStatusId,
    },
  });

/** The facts the recorder would have been given: the class that was confirmed, and the price a
 * course was moved to. Named answers, none of them read by position. */
const DECIDED = { from: 'pending', to: 'confirmed' };

const record = (overrides: Record<string, unknown> = {}) =>
  prisma.actionLog.create({
    data: {
      actionCode: ACTION_CODES.COURSE_PUBLISHED,
      sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
      actorKind: ACTION_ACTOR_KIND_CODES.USER,
      targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
      targetId: randomUUID(),
      ...overrides,
    },
  });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  studentRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.STUDENT);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
});

afterAll(async () => {
  // The order is the restriction: a person whose actions are on record cannot be deleted, so the
  // rows naming them go first.
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('action_log table', () => {
  it('states who, what, to which row, and where it happened', async () => {
    const teacher = await createPerson('teacher', teacherRoleId);

    const created = await record({
      actorUserId: teacher.id,
      actorRoleCode: ROLE_CODES.TEACHER,
      detail: DECIDED,
      requestId: `${RUN}-request`,
    });

    expect(created).toMatchObject({
      actionCode: 'course_published',
      sectionCode: 'course_authoring',
      actorKind: 'user',
      actorUserId: teacher.id,
      actorRoleCode: 'teacher',
      targetTable: 'course',
      detail: DECIDED,
      requestId: `${RUN}-request`,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.targetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it('has no half that can be changed, which is the whole promise of an append-only ledger', async () => {
    const created = await record();

    // `updatedAt` and `isActive` are absent, and not by oversight: §2 requires them on major tables
    // and excludes them from ledgers, because a column that says when a row was edited is an
    // invitation to edit a row that records what somebody else did. A correction here is a second
    // row, and the first one stays as the record that it was believed.
    expect(Object.keys(created).sort()).toEqual(
      [
        'actionCode',
        'actorKind',
        'actorRoleCode',
        'actorUserId',
        'createdAt',
        'detail',
        'id',
        'requestId',
        'sectionCode',
        'targetId',
        'targetTable',
      ].sort(),
    );
  });

  it('lets the scheduler be the actor, with no person to name', async () => {
    // The expiry sweep's row: `actorUserId` null, and the reason it is not invented is the
    // `actorKind` column rather than a guess a reader would have to make. `requestId` is null for
    // the same reason — a cron has no request for an access log line to point back to.
    const swept = await record({
      actionCode: ACTION_CODES.BOOKING_EXPIRED,
      sectionCode: ACTION_SECTION_CODES.BOOKING,
      targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
      actorKind: ACTION_ACTOR_KIND_CODES.SYSTEM,
    });

    expect(swept).toMatchObject({
      actionCode: 'booking_expired',
      actorKind: 'system',
      actorUserId: null,
      actorRoleCode: null,
      requestId: null,
    });
  });

  it('names the person who did it, and will not name somebody who does not exist', async () => {
    await expect(record({ actorUserId: randomUUID() })).rejects.toThrow();
  });

  it('will not let a person disappear out from under their own record', async () => {
    const teacher = await createPerson('kept', teacherRoleId);
    await record({ actorUserId: teacher.id });

    // The same restriction the outbox puts on a letter waiting for a reader: the row is the record
    // that this account did something, and a log with an id that resolves to nobody answers
    // "who" with a uuid. Accounts are deactivated rather than deleted, so this is a ceiling on a
    // mistake rather than a rule anybody will meet.
    await expect(prisma.user.delete({ where: { id: teacher.id } })).rejects.toThrow();
  });

  it('points at a row rather than holding one, so the thing it describes can be retired', async () => {
    // The target is a table name and an id with no foreign key behind either, for the reason 6c
    // gave for not keying `event_code` into `email_template`: a reference that could fail would let
    // a bookkeeping problem destroy the business write it was only there to record. A course
    // published today and archived next year is one course, and the log row outlives neither —
    // it simply keeps pointing at the row as it was named.
    await expect(
      record({ targetId: randomUUID(), targetTable: ACTION_TARGET_TABLE_CODES.COURSE }),
    ).resolves.toMatchObject({ targetTable: 'course' });

    // And a table name that is not a table at all is acceptable here for the same reason a status
    // outside the list is: the column records what a writer believed, and the vocabulary is proved
    // where the vocabulary lives.
    await expect(record({ targetTable: `${RUN}_not_a_table` })).resolves.toMatchObject({
      targetTable: `${RUN}_not_a_table`,
    });
  });

  it('decides nothing about which actions, sections or kinds are the real list', async () => {
    // Both halves are code's business, and the lists in `@lms/shared` are where they are written.
    // The recorder refuses an unknown action before this table ever sees one.
    await expect(
      record({
        actionCode: `${RUN}.anything_at_all`,
        sectionCode: `${RUN}.somewhere`,
        actorKind: 'invented_by_a_test',
      }),
    ).resolves.toMatchObject({ actionCode: `${RUN}.anything_at_all`, actorKind: 'invented_by_a_test' });
  });

  it('lets the same action be recorded twice, and says nothing about which one is the real one', async () => {
    const teacher = await createPerson('twice', teacherRoleId);
    const booking = randomUUID();

    const first = await record({
      actionCode: ACTION_CODES.BOOKING_CONFIRMED,
      sectionCode: ACTION_SECTION_CODES.BOOKING,
      targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
      targetId: booking,
      actorUserId: teacher.id,
    });
    const second = await record({
      actionCode: ACTION_CODES.BOOKING_CONFIRMED,
      sectionCode: ACTION_SECTION_CODES.BOOKING,
      targetTable: ACTION_TARGET_TABLE_CODES.BOOKING,
      targetId: booking,
      actorUserId: teacher.id,
    });

    // Nothing is unique on this table, which is the same property the queue has: a double press that
    // really did two things is two facts, and a unique key would refuse the second one inside the
    // transaction that was only trying to record what happened. That the *recorder* files nothing
    // for a replay that changed nothing is 7b's rule, and it is a rule about when record() is called
    // rather than about what a row may hold.
    expect(second.id).not.toBe(first.id);
  });

  it('holds the decided facts as named answers, and keeps no order to read them by', async () => {
    const created = await record({ detail: { priceBefore: '400.00', priceAfter: '450.00' } });

    // `jsonb` is the second of its kind in this schema and it drops the writer's key order, so a
    // reader asks for `priceBefore` rather than for the first element. Nothing in `detail` is a
    // whole copy of the row the action touched: a snapshot carries personal data forward past both
    // the correction and the deletion, and grows with every column the table gains.
    const read = await prisma.actionLog.findFirstOrThrow({ where: { id: created.id } });
    expect(read.detail).toEqual({ priceBefore: '400.00', priceAfter: '450.00' });

    // The table cannot enforce that, and does not try: what may and may not go in here is the
    // recorder's rule, proved where the recorder lives. A room name is a string like any other.
    await expect(
      prisma.actionLog.update({ where: { id: created.id }, data: { detail: { room: 'a-name' } } }),
    ).resolves.toMatchObject({ detail: { room: 'a-name' } });
  });

  it('answers the questions the read side will ask', async () => {
    const teacher = await createPerson('asked', teacherRoleId);
    const student = await createPerson('watched', studentRoleId);
    const courseId = randomUUID();

    const older = await record({
      actorUserId: teacher.id,
      targetId: courseId,
      createdAt: new Date('2026-09-20T09:00:00.000Z'),
    });
    const newest = await record({
      actorUserId: teacher.id,
      actionCode: ACTION_CODES.COURSE_ARCHIVED,
      targetId: courseId,
      createdAt: new Date('2026-09-21T09:00:00.000Z'),
    });
    await record({
      actorUserId: student.id,
      actionCode: ACTION_CODES.ENROLLMENT_JOINED,
      sectionCode: ACTION_SECTION_CODES.ENROLLMENT,
      targetTable: ACTION_TARGET_TABLE_CODES.ENROLLMENT,
    });

    // What a teacher did, newest first — the one read an operator asks more than any other.
    const byActor = await prisma.actionLog.findMany({
      where: { actorUserId: teacher.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(byActor.map((row) => row.id)).toEqual([newest.id, older.id]);

    // Everything that happened to one row, whichever part of the app it came from, which is the
    // question that has no answer without the target pair being indexed together.
    const aboutCourse = await prisma.actionLog.findMany({
      where: { targetTable: ACTION_TARGET_TABLE_CODES.COURSE, targetId: courseId },
      select: { actionCode: true },
    });
    expect(aboutCourse.map((row) => row.actionCode).sort()).toEqual([
      'course_archived',
      'course_published',
    ]);

    // And a section on its own, because "everything in the syllabus editor" is a different question
    // from "everything this person did" — and the two answers overlap without being the same set.
    const inAuthoring = await prisma.actionLog.findMany({
      where: {
        sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
        actorUserId: teacher.id,
      },
      select: { id: true },
    });
    expect(inAuthoring.map((row) => row.id).sort()).toEqual([older.id, newest.id].sort());
  });
});
