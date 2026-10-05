import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ATTENDANCE_STATUS_CODES } from '@lms/shared';

import { AppModule } from '../src/app.module';
import { ClassOccurrenceService } from '../src/modules/calendar/class-occurrence.service';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The minute after the class: the register a teacher marks.
 *
 * `class_attendance` has existed since Stage 2 wrote it — one line per name per dated class, with a
 * status column the sweep leaves null — because the calendar that generates classes has to know who
 * is expected. This file is the other half: the two doors that make a line *say* something, and the
 * rules about who may make it say that.
 *
 * Three decisions hold this together, and all three are tested here rather than assumed.
 *
 * A roll is asked for one class at a time. A teacher marks the lesson that just happened, not a
 * week and not a course, so the address names a dated class and the answer is the sheet under it.
 *
 * The class has to have started. Attendance is a report about an event, and a report written before
 * the event is a prediction wearing the wrong clothes — so the read says whether a mark may be
 * written, and the write refuses when it may not.
 *
 * And nothing is destroyed. A line whose mark is taken back goes to unmarked, which is the state it
 * was in before anybody answered, and a student who has left the course simply stops being on the
 * sheet while their row and its answer stay where the history reads them.
 */
const RUN = `${randomUUID().slice(0, 8)}-${process.pid}-${Date.now()}`;
const DOMAIN = `${RUN}.localtest.me`;
const emailFor = (name: string) => `${name}@${DOMAIN}`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

// The teacher is kept on UTC so a class named by the sweep can be moved by the hour without asking
// what the server's own clock thinks today is.
const TEACHER_ZONE = 'UTC';

const START_MINUTES = 540;
const WINDOW_MINUTES = 60;
const MS_PER_HOUR = 60 * 60 * 1000;

interface RollLine {
  id: string;
  student: { id: string; fullName: string };
  status: string | null;
}

interface Roll {
  classId: string;
  course: { id: string; slug: string; title: string };
  startsAt: string;
  endsAt: string;
  canMark: boolean;
  lines: RollLine[];
}

let app: INestApplication;
let sweeper: ClassOccurrenceService;
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

async function named(name: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email: emailFor(name) } });
  return user.id;
}

let courseSequence = 0;

async function createPublishedCourse(teacher: string, titleWord: string): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title: `${titleWord} seminar ${courseSequence} ${MARK}`,
      slug: `roll-${titleWord.toLowerCase()}-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'An hour, every week.',
      description: 'We meet on the same hour each day and work through one thing at a time.',
    })
    .expect(201);
  const id = res.body.course.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${teacher}`)
    .expect(200);
  return id;
}

async function addSeries(teacher: string, courseId: string, weekday: number): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/series`)
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      weekday,
      startMinutes: START_MINUTES,
      endMinutes: START_MINUTES + WINDOW_MINUTES,
      durationMinutes: WINDOW_MINUTES,
    })
    .expect(201);
}

async function enroll(student: string, courseId: string): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${student}`)
    .send({ courseId })
    .expect(200);
}

function roll(token: string, classId: string): request.Test {
  return request(app.getHttpServer())
    .get(`/api/v1/classes/${classId}/roll`)
    .set('Authorization', `Bearer ${token}`);
}

async function seenRoll(token: string, classId: string): Promise<Roll> {
  const res = await roll(token, classId).expect(200);
  return res.body as Roll;
}

function saveRoll(token: string, classId: string, lines: unknown[]): request.Test {
  return request(app.getHttpServer())
    .put(`/api/v1/classes/${classId}/roll`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lines });
}

/** The classes the sweep owes one course, oldest first. */
function rowsOf(courseId: string) {
  return prisma.classOccurrence.findMany({
    where: { courseId },
    orderBy: { startsAt: 'asc' },
  });
}

let teacherToken: string;
let courseId: string;
/** A class moved back two hours, so the hour it stood in has passed. */
let pastClassId: string;
/** A class still ahead of the clock. */
let futureClassId: string;
/** A class the sweep has stopped believing in. */
let retiredClassId: string;
let studentIds: Record<string, string>;

beforeAll(async () => {
  await seedLookups(prisma);
  app = await createTestApp({ imports: [AppModule] });
  sweeper = app.get(ClassOccurrenceService);

  await open('roll', 'teacher');
  await open('othr', 'teacher');
  for (const student of ['ana', 'ben', 'cid']) await open(student, 'student');

  teacherToken = as('roll');
  const teacherId = await named('roll');
  await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });

  courseId = await createPublishedCourse(teacherToken, 'cohort');
  for (let weekday = 1; weekday <= 7; weekday += 1)
    await addSeries(teacherToken, courseId, weekday);
  for (const student of ['ana', 'ben', 'cid']) await enroll(as(student), courseId);

  await sweeper.sweep(new Date());

  studentIds = {
    ana: await named('ana'),
    ben: await named('ben'),
    cid: await named('cid'),
  };

  const rows = await rowsOf(courseId);
  const rowAt = (index: number) => {
    const row = rows[index];
    if (!row) {
      throw new Error(
        `A week of series owed ${index + 1} classes and the sweep wrote ${rows.length}.`,
      );
    }
    return row;
  };
  pastClassId = rowAt(0).id;
  futureClassId = rowAt(1).id;
  retiredClassId = rowAt(2).id;

  // The past is made by moving a row the sweep already wrote, which is exactly what time does to
  // one: the class was in the horizon, then it was not, and nothing about the row changed.
  await prisma.classOccurrence.update({
    where: { id: pastClassId },
    data: { startsAt: new Date(Date.now() - 2 * MS_PER_HOUR) },
  });
  await prisma.classOccurrence.update({
    where: { id: retiredClassId },
    data: { isActive: false },
  });
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
      where: {
        OR: [{ studentUserId: { in: userIds } }, { occurrence: { courseId: { in: courseIds } } }],
      },
    });
    await prisma.classOccurrence.deleteMany({
      where: { OR: [{ teacherUserId: { in: userIds } }, { courseId: { in: courseIds } }] },
    });
    await prisma.classSeries.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.enrollment.deleteMany({
      where: { OR: [{ studentUserId: { in: userIds } }, { courseId: { in: courseIds } }] },
    });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  }

  await prisma.$disconnect();
});

describe('the roll of one class', () => {
  it('names everybody the class is standing for, and says nobody has answered yet', async () => {
    const roll = await seenRoll(teacherToken, pastClassId);

    expect(roll.classId).toBe(pastClassId);
    expect(roll.course.id).toBe(courseId);
    expect(roll.canMark).toBe(true);
    expect(roll.lines.map((line) => line.student.fullName)).toEqual([
      'ana Person',
      'ben Person',
      'cid Person',
    ]);
    expect(roll.lines.map((line) => line.status)).toEqual([null, null, null]);
  });

  it('says a class that has not started has nothing to mark', async () => {
    const roll = await seenRoll(teacherToken, futureClassId);

    // The names are there — a teacher can look at next Tuesday's sheet — but the answer is not
    // writable until the hour has happened, and the read is what says so.
    expect(roll.canMark).toBe(false);
    expect(roll.lines).toHaveLength(3);
  });

  it('has no roll for a class the platform stopped believing in', async () => {
    // A retired row is a class that never stood, so it never owed anybody a place on a sheet.
    await roll(teacherToken, retiredClassId).expect(404);
  });

  it('is not somebody else’s class', async () => {
    // The capability opens the door; the row is not the caller's. The answer is the one every
    // other teacher-owned route gives: this id is not a thing you have.
    await roll(as('othr'), pastClassId).expect(404);
  });

  it('is not a student’s question to ask', async () => {
    // A student sees their own mark on their own list. The sheet — every name, and who of them
    // came — belongs to whoever runs the course.
    await roll(as('ana'), pastClassId).expect(403);
  });

  it('asks for a session', async () => {
    await request(app.getHttpServer()).get(`/api/v1/classes/${pastClassId}/roll`).expect(401);
  });
});

describe('marking the roll', () => {
  it('writes the answers and reads them back', async () => {
    const res = await saveRoll(teacherToken, pastClassId, [
      { studentId: studentIds.ana, status: ATTENDANCE_STATUS_CODES.PRESENT },
      { studentId: studentIds.ben, status: ATTENDANCE_STATUS_CODES.ABSENT },
    ]).expect(200);

    const saved = res.body as Roll;
    expect(saved.lines.find((line) => line.student.id === studentIds.ana)?.status).toBe('present');
    expect(saved.lines.find((line) => line.student.id === studentIds.ben)?.status).toBe('absent');
    // A name the body did not mention keeps its silence rather than being answered for.
    expect(saved.lines.find((line) => line.student.id === studentIds.cid)?.status).toBeNull();

    const again = await seenRoll(teacherToken, pastClassId);
    expect(again.lines.find((line) => line.student.id === studentIds.ben)?.status).toBe('absent');
  });

  it('takes an answer back when the teacher puts the line right', async () => {
    await saveRoll(teacherToken, pastClassId, [{ studentId: studentIds.ben, status: null }]).expect(
      200,
    );

    const roll = await seenRoll(teacherToken, pastClassId);
    expect(roll.lines.find((line) => line.student.id === studentIds.ben)?.status).toBeNull();
  });

  it('refuses a name the class is not standing for, and writes nothing', async () => {
    const before = await seenRoll(teacherToken, pastClassId);

    await saveRoll(teacherToken, pastClassId, [
      { studentId: studentIds.ana, status: ATTENDANCE_STATUS_CODES.ABSENT },
      { studentId: 'nobody-on-this-sheet', status: ATTENDANCE_STATUS_CODES.PRESENT },
    ]).expect(400);

    const after = await seenRoll(teacherToken, pastClassId);
    expect(after.lines.map((line) => line.status)).toEqual(before.lines.map((line) => line.status));
  });

  it('refuses a word the register does not have', async () => {
    await saveRoll(teacherToken, pastClassId, [
      { studentId: studentIds.ana, status: 'running_late' },
    ]).expect(400);
  });

  it('refuses two answers about the same name', async () => {
    // Whichever of the two won, a body that says one person came and did not come is not a roll a
    // teacher meant to send, and the table cannot guess which half to keep.
    await saveRoll(teacherToken, pastClassId, [
      { studentId: studentIds.ana, status: ATTENDANCE_STATUS_CODES.PRESENT },
      { studentId: studentIds.ana, status: ATTENDANCE_STATUS_CODES.ABSENT },
    ]).expect(400);
  });

  it('refuses a class that has not started', async () => {
    await saveRoll(teacherToken, futureClassId, [
      { studentId: studentIds.ana, status: ATTENDANCE_STATUS_CODES.PRESENT },
    ]).expect(409);

    const roll = await seenRoll(teacherToken, futureClassId);
    expect(roll.lines.every((line) => line.status === null)).toBe(true);
  });

  it('is not somebody else’s class to mark', async () => {
    await saveRoll(as('othr'), pastClassId, [
      { studentId: studentIds.ana, status: ATTENDANCE_STATUS_CODES.PRESENT },
    ]).expect(404);
  });

  it('is not a student’s answer to give', async () => {
    await saveRoll(as('ana'), pastClassId, [
      { studentId: studentIds.ana, status: ATTENDANCE_STATUS_CODES.PRESENT },
    ]).expect(403);
  });

  it('survives the next sweep', async () => {
    // The sweep owns the forward horizon and nothing else. A class whose hour has passed is not in
    // any run's window, so the answers on it are the last word — which is the whole reason a
    // register is a table rather than something derived afresh from the pattern.
    await sweeper.sweep(new Date());

    const roll = await seenRoll(teacherToken, pastClassId);
    expect(roll.lines.find((line) => line.student.id === studentIds.ana)?.status).toBe('present');
  });

  it('reaches the student’s own list as their mark', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/classes/learning')
      .query({
        from: new Date(Date.now() - 6 * MS_PER_HOUR).toISOString(),
        to: new Date(Date.now() + 24 * MS_PER_HOUR).toISOString(),
      })
      .set('Authorization', `Bearer ${as('ana')}`)
      .expect(200);

    const row = (res.body.items as { id: string; status: string | null }[]).find(
      (item) => item.id === pastClassId,
    );
    expect(row?.status).toBe('present');
  });
});
