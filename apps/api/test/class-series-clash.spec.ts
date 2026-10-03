import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * One teacher cannot stand in two rooms at once.
 *
 * A [[series]] is a plan for one course, and the write that took it used to ask one question: does
 * *this course* already open at *this minute*. Both halves of that are too small. A teacher who runs
 * Algebra at Monday 09:00–10:30 and Verbs at Monday 10:00–11:00 has scheduled two classes over the
 * same half hour, on two different courses, and nothing refused it; and inside one course, a window
 * 09:45–10:15 beside the 09:00–10:30 that already stood was equally welcome, because its opening
 * minute was new. Since §2c every one of those patterns comes out as a dated class on the same
 * person's calendar, so the platform was writing a month of Mondays at which the teacher is
 * expected in two places.
 *
 * The rule this file holds is the one the availability windows already follow (§13): **touching is
 * not overlapping**. Monday 09:00–10:00 and Monday 10:00–11:00 are two classes, and a teacher who
 * teaches four of them in a day is running a timetable rather than breaking one. What is refused is
 * a minute two of their own classes both claim — and the refusal reaches across their courses,
 * because the body that has to be in both rooms is the account, not the course.
 *
 * It stops at the account. Two teachers at the same minute on the same weekday is a normal Tuesday
 * in a marketplace, and another person's hour was never this write's business.
 */
const RUN = randomUUID().slice(0, 8);
const DOMAIN = `${RUN}.localtest.me`;
const emailFor = (name: string) => `${name}@${DOMAIN}`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

const MONDAY = 1;
const WEDNESDAY = 3;
const NINE = 540;
const EVENING = 1140;

let app: INestApplication;
const prisma = new PrismaClient();

const tokens = new Map<string, string>();
const as = (name: string) => {
  const token = tokens.get(name);
  if (!token) throw new Error(`No session was ever opened for ${name}.`);
  return token;
};

async function open(name: string, role: string): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD })
    .expect(200);
  tokens.set(name, res.body.accessToken as string);
}

let courseSequence = 0;

async function createPublishedCourse(token: string, titleWord: string): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `${titleWord} course ${courseSequence} ${MARK}`,
      slug: `clash-${titleWord.toLowerCase()}-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'An hour, every week.',
      description: 'We meet on the same hour each week and work through one thing at a time.',
    })
    .expect(201);
  const id = res.body.course.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return id;
}

interface SeriesWrite {
  weekday?: number;
  startMinutes?: number;
  endMinutes?: number;
  durationMinutes?: number;
}

function postSeries(token: string, courseId: string, body: SeriesWrite): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/series`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      weekday: MONDAY,
      startMinutes: NINE,
      endMinutes: NINE + 60,
      durationMinutes: 60,
      ...body,
    });
}

async function addSeries(
  token: string,
  courseId: string,
  body: SeriesWrite = {},
): Promise<{ id: string }> {
  const res = await postSeries(token, courseId, body).expect(201);
  return res.body.series as { id: string };
}

function patchSeries(token: string, courseId: string, id: string, body: SeriesWrite): request.Test {
  return request(app.getHttpServer())
    .patch(`/api/v1/courses/${courseId}/series/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function retireSeries(token: string, courseId: string, id: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/series/${id}/retire`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  await seedLookups(prisma);
  app = await createTestApp({ imports: [AppModule] });

  await open('own', 'teacher');
  await open('other', 'teacher');
});

afterAll(async () => {
  await app?.close();

  const userIds = (
    await prisma.user.findMany({
      where: { email: { endsWith: `@${DOMAIN}` } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const courseIds = (
    await prisma.course.findMany({
      where: { teacherUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((row) => row.id);

  if (userIds.length > 0) {
    await prisma.classAttendance.deleteMany({
      where: { occurrence: { courseId: { in: courseIds } } },
    });
    await prisma.classOccurrence.deleteMany({
      where: { OR: [{ teacherUserId: { in: userIds } }, { courseId: { in: courseIds } }] },
    });
    await prisma.holiday.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.classSeries.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.enrollment.deleteMany({
      where: { OR: [{ studentUserId: { in: userIds } }, { courseId: { in: courseIds } }] },
    });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.$disconnect();
});

describe('a teacher’s own week', () => {
  let algebra: string;
  let verbs: string;
  let mondayNine: { id: string };

  beforeAll(async () => {
    algebra = await createPublishedCourse(as('own'), 'Algebra');
    verbs = await createPublishedCourse(as('own'), 'Verbs');
    mondayNine = await addSeries(as('own'), algebra, {
      startMinutes: NINE,
      endMinutes: NINE + 90,
      durationMinutes: 60,
    });
  });

  it('takes the same day again an hour later, because touching is not overlapping', async () => {
    // 10:30 is exactly where Monday 09:00–10:30 closes, so the two classes are deliverable one after
    // the other. A teacher who keeps four courses running through a day does that seven days a week,
    // and none of it is a collision.
    const later = await addSeries(as('own'), verbs, {
      startMinutes: NINE + 90,
      endMinutes: NINE + 150,
      durationMinutes: 60,
    });
    expect(later.id).toMatch(/./);
  });

  it('refuses a second course over a minute the first class is still teaching through', async () => {
    const before = await prisma.classSeries.count({ where: { courseId: verbs, isActive: true } });

    const res = await postSeries(as('own'), verbs, {
      startMinutes: NINE + 30,
      endMinutes: NINE + 60,
      durationMinutes: 30,
    }).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body)).toContain('Monday');
    // A refused write leaves nothing behind.
    expect(await prisma.classSeries.count({ where: { courseId: verbs, isActive: true } })).toBe(
      before,
    );
  });

  it('refuses the same course at a minute it did not open at', async () => {
    // The old guard compared opening minutes, so this one — 09:45, inside a class that has been
    // running since 09:00 — used to be accepted on the course that already held it.
    await postSeries(as('own'), algebra, {
      startMinutes: NINE + 45,
      endMinutes: NINE + 75,
      durationMinutes: 30,
    }).expect(409);
  });

  it('refuses an edit that moves a class onto one already standing', async () => {
    const moved = await patchSeries(as('own'), algebra, mondayNine.id, {
      startMinutes: NINE + 90,
      endMinutes: NINE + 150,
      durationMinutes: 60,
    }).expect(409);
    expect(moved.body.code).toBe('CONFLICT');

    const row = await prisma.classSeries.findFirstOrThrow({ where: { id: mondayNine.id } });
    expect(row.startMinutes).toBe(NINE);
    expect(row.endMinutes).toBe(NINE + 90);
  });

  it('lets an edit that leaves the window where it was through', async () => {
    // The series is compared against everything *except* itself, or a teacher could never press
    // Save on a class they had not moved.
    await patchSeries(as('own'), algebra, mondayNine.id, {
      startMinutes: NINE,
      endMinutes: NINE + 90,
      durationMinutes: 45,
    }).expect(200);
  });

  it('holds a different day of the week clear of the same hour', async () => {
    const wednesday = await addSeries(as('own'), verbs, {
      weekday: WEDNESDAY,
      startMinutes: NINE,
      endMinutes: NINE + 60,
      durationMinutes: 60,
    });
    expect(wednesday.id).toMatch(/./);
  });

  it('gives the hour back when the class that held it is retired', async () => {
    await retireSeries(as('own'), algebra, mondayNine.id).expect(200);

    const reclaimed = await addSeries(as('own'), algebra, {
      startMinutes: NINE,
      endMinutes: NINE + 60,
      durationMinutes: 60,
    });
    expect(reclaimed.id).toMatch(/./);
  });

  it('refuses a window that does not end after it starts before it asks about clashes', async () => {
    const res = await postSeries(as('own'), algebra, {
      startMinutes: NINE,
      endMinutes: NINE,
      durationMinutes: 30,
    }).expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });
});

describe('two teachers', () => {
  let mine: string;
  let theirs: string;

  beforeAll(async () => {
    mine = await createPublishedCourse(as('own'), 'Botany');
    theirs = await createPublishedCourse(as('other'), 'Ceramics');
  });

  it('leaves another account the same minute on the same weekday', async () => {
    // 19:00 rather than 09:00, because the teacher writing the first half of this pair already runs
    // a class at Monday 09:00 — the guard is about the account, so the hour it holds is closed to
    // that account on every course, and this test is about an hour neither account holds.
    await addSeries(as('own'), mine, {
      startMinutes: EVENING,
      endMinutes: EVENING + 60,
      durationMinutes: 60,
    });

    // A marketplace has two teachers at Monday 19:00 all the time; the guard is about the body that
    // has to be in the room, and there is only ever one of those per account.
    const twin = await addSeries(as('other'), theirs, {
      startMinutes: EVENING,
      endMinutes: EVENING + 60,
      durationMinutes: 60,
    });
    expect(twin.id).toMatch(/./);
  });

  it('still refuses a series written on somebody else’s course', async () => {
    // Ownership is asked before the calendar is read, so another teacher's hour is not even a
    // clash candidate for this account — and their course is not a course this one can write on.
    await postSeries(as('own'), theirs, {
      startMinutes: NINE,
      endMinutes: NINE + 60,
      durationMinutes: 30,
    }).expect(404);
  });
});
