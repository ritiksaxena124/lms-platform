import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ATTENDANCE_STATUS_CODES, LKP_TYPE_CODES } from '@lms/shared';

import { AppModule } from '../src/app.module';
import { ClassOccurrenceService } from '../src/modules/calendar/class-occurrence.service';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A plan becoming a term: the sweep that turns a series into dated classes, and the two doors that
 * read them back.
 *
 * `class_series` holds a pattern — Monday at 09:00, every week — and a pattern is not something a
 * teacher can stand in front of. Between the two sits this file's subject: a row for every class
 * that is still going to happen, written down rather than derived afresh on each page load, because
 * a cohort is not one student's claim on one minute (the booking table's race guard makes that
 * impossible) and because a register of names has to exist beside a class before anybody attends it.
 *
 * Two rules run everything here, and both are tested rather than assumed.
 *
 * The sweep governs the forward horizon only. A class whose minute has passed is history, and no
 * later edit to a pattern — a day off, a retirement, a moved hour — may reach back and change what
 * happened that day.
 *
 * And it is idempotent, because it runs on a clock, may run beside itself on a second API instance,
 * and is called again by every write a teacher makes. Running it twice leaves the same state, and
 * the rows it already wrote keep their ids: a class that comes back is the class that was paused,
 * not a new row wearing the old one's name.
 */
const RUN = randomUUID().slice(0, 8);
const DOMAIN = `${RUN}.localtest.me`;
const emailFor = (name: string) => `${name}@${DOMAIN}`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

// The week is cut in the teacher's own clock, so this account is kept on UTC: 09:00 on the profile
// is 09:00 in the table, and a test can name a day without asking what the server's timezone thinks
// today is.
const TEACHER_ZONE = 'UTC';

const START_MINUTES = 540;
const WINDOW_MINUTES = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 30;

interface TeachingRow {
  id: string;
  seriesId: string;
  course: { id: string; slug: string; title: string };
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  studentsExpected: number;
}

interface LearningRow {
  id: string;
  course: { id: string; slug: string; title: string };
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string | null;
}

let app: INestApplication;
let sweeper: ClassOccurrenceService;
const prisma = new PrismaClient();

/** Each fixture person keeps one session for the whole file; the name is the handle on it. */
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

async function createPublishedCourse(
  teacher: string,
  titleWord: string,
): Promise<{ id: string; slug: string }> {
  courseSequence += 1;
  const slug = `cohort-${titleWord.toLowerCase()}-${courseSequence}-${RUN}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      title: `${titleWord} workshop ${courseSequence} ${MARK}`,
      slug,
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
  return { id, slug };
}

/** One series: this weekday, 09:00 to 10:00, a sixty-minute class. */
async function addSeries(
  teacher: string,
  courseId: string,
  weekday: number,
): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/series`)
    .set('Authorization', `Bearer ${teacher}`)
    .send({
      weekday,
      startMinutes: START_MINUTES,
      endMinutes: START_MINUTES + WINDOW_MINUTES,
      durationMinutes: WINDOW_MINUTES,
    })
    .expect(201);
  return res.body.series as { id: string };
}

/** The week filled, so a horizon of a month has classes in it whichever day it is opened on. */
async function scheduleWeek(teacher: string, courseId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const series = await addSeries(teacher, courseId, weekday);
    ids.push(series.id);
  }
  return ids;
}

async function retireSeries(teacher: string, courseId: string, seriesId: string): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/series/${seriesId}/retire`)
    .set('Authorization', `Bearer ${teacher}`)
    .expect(200);
}

async function enroll(student: string, courseId: string): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${student}`)
    .send({ courseId })
    .expect(200);
}

async function leave(studentName: string, courseId: string): Promise<void> {
  const place = await prisma.enrollment.findFirstOrThrow({
    where: { courseId, studentUserId: await named(studentName) },
  });
  await request(app.getHttpServer())
    .post(`/api/v1/enrollments/${place.id}/cancel`)
    .set('Authorization', `Bearer ${as(studentName)}`)
    .expect(200);
}

async function markDayOff(token: string, date: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/availability/holidays')
    .set('Authorization', `Bearer ${token}`)
    .send({ date, reason: 'A day nobody teaches' })
    .expect(201);
  return res.body.holiday.id as string;
}

async function liftDayOff(token: string, id: string): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/v1/availability/holidays/${id}/retire`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
}

function teaching(token?: string, window?: { from: Date; to: Date }): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/classes/teaching');
  if (window) {
    call.query({ from: window.from.toISOString(), to: window.to.toISOString() });
  }
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function seenTeaching(
  token: string,
  window?: { from: Date; to: Date },
): Promise<TeachingRow[]> {
  const res = await teaching(token, window).expect(200);
  return res.body.items as TeachingRow[];
}

function learning(token?: string, window?: { from: Date; to: Date }): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/classes/learning');
  if (window) {
    call.query({ from: window.from.toISOString(), to: window.to.toISOString() });
  }
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

async function seenLearning(
  token: string,
  window?: { from: Date; to: Date },
): Promise<LearningRow[]> {
  const res = await learning(token, window).expect(200);
  return res.body.items as LearningRow[];
}

/** The rows the sweep owes one course, read from the table rather than through a door. */
function rowsOf(courseId: string, where: Record<string, unknown> = {}) {
  return prisma.classOccurrence.findMany({
    where: { courseId, ...where },
    orderBy: { startsAt: 'asc' },
  });
}

/** The `YYYY-MM-DD` a UTC-kept teacher reads on an instant. */
function dayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

let presentStatusId: string;
let teacherId: string;

beforeAll(async () => {
  await seedLookups(prisma);
  app = await createTestApp({ imports: [AppModule] });
  sweeper = app.get(ClassOccurrenceService);

  presentStatusId = (
    await prisma.lkpValue.findFirstOrThrow({
      where: {
        type: { code: LKP_TYPE_CODES.ATTENDANCE_STATUS },
        code: ATTENDANCE_STATUS_CODES.PRESENT,
      },
    })
  ).id;

  for (const [name, role] of [
    ['gen', 'teacher'],
    ['else', 'teacher'],
    ['thrd', 'teacher'],
    ['clear', 'teacher'],
    ['one', 'student'],
    ['two', 'student'],
    ['three', 'student'],
    ['four', 'student'],
    ['fifth', 'student'],
  ] as const) {
    await open(name, role);
  }

  teacherId = await named('gen');
  await prisma.user.update({ where: { id: teacherId }, data: { timezone: TEACHER_ZONE } });
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

describe('the sweep that fills a cohort calendar', () => {
  let course: { id: string; slug: string };
  let seriesIds: string[];

  beforeAll(async () => {
    course = await createPublishedCourse(as('gen'), 'Swept');
    await enroll(as('one'), course.id);
    await enroll(as('two'), course.id);
    seriesIds = await scheduleWeek(as('gen'), course.id);
  });

  /** One of the week's plans, named by position. An array index cannot say the week was scheduled. */
  function seriesAt(index: number): string {
    const id = seriesIds[index];
    if (!id)
      throw new Error('A week that was scheduled seven times has no series at that position.');
    return id;
  }

  it('makes the dated classes as soon as the series is scheduled', async () => {
    // No sweep call: a teacher who has just written a plan looks at a calendar, and a screen that
    // was right only after the next hour on the clock would read as a bug in the write.
    const rows = await rowsOf(course.id);
    const now = new Date();
    const to = new Date(now.getTime() + HORIZON_DAYS * MS_PER_DAY);
    const teacher = await named('gen');

    expect(rows.length).toBeGreaterThan(20);
    expect(new Set(rows.map((row) => row.startsAt.getTime())).size).toBe(rows.length);

    for (const row of rows) {
      expect(row.isActive).toBe(true);
      expect(row.teacherUserId).toBe(teacher);
      expect(row.durationMinutes).toBe(WINDOW_MINUTES);
      expect(row.startsAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
      expect(row.startsAt.getTime()).toBeLessThan(to.getTime());
      expect(row.startsAt.getUTCHours()).toBe(9);
      expect(row.startsAt.getUTCMinutes()).toBe(0);
    }
  });

  it('writes the register beside every class, from the names holding a place', async () => {
    const [row] = await rowsOf(course.id);
    if (!row) throw new Error('A swept week came back with no classes.');

    const sheet = await prisma.classAttendance.findMany({
      where: { occurrenceId: row.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(sheet).toHaveLength(2);
    expect(sheet.every((line) => line.isActive)).toBe(true);
    // Unmarked rather than marked "pending": the teacher has not been in the room yet, and the
    // absence of a mark is the honest state of a class that has not happened.
    expect(sheet.every((line) => line.statusValueId === null)).toBe(true);

    const names = new Set(sheet.map((line) => line.studentUserId));
    expect(names.has(await named('one'))).toBe(true);
    expect(names.has(await named('two'))).toBe(true);
  });

  it('runs the same week twice without adding a class or moving one', async () => {
    const before = await rowsOf(course.id);
    const untouched = await prisma.classAttendance.findFirstOrThrow({
      where: { occurrence: { courseId: course.id } },
    });

    await sweeper.reconcileTeacher(teacherId, new Date());
    await sweeper.reconcileTeacher(teacherId, new Date());

    const after = await rowsOf(course.id);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));

    const doubled = await prisma.classOccurrence.groupBy({
      by: ['seriesId', 'startsAt'],
      where: { courseId: course.id },
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    });
    expect(doubled).toHaveLength(0);

    const stillThere = await prisma.classAttendance.findUniqueOrThrow({
      where: { id: untouched.id },
    });
    expect(stillThere.isActive).toBe(untouched.isActive);
    expect(stillThere.statusValueId).toBe(untouched.statusValueId);
  });

  it('gives a student who joined late their line in the classes still to come', async () => {
    await enroll(as('three'), course.id);
    await sweeper.reconcileTeacher(teacherId, new Date());

    const expected = await rowsOf(course.id, { isActive: true });
    const lines = await prisma.classAttendance.findMany({
      where: {
        occurrenceId: { in: expected.map((row) => row.id) },
        studentUserId: await named('three'),
      },
    });

    expect(lines).toHaveLength(expected.length);
    expect(lines.every((line) => line.isActive)).toBe(true);
  });

  it('takes a departed student off the classes still to come, and puts them back on the same line', async () => {
    const three = await named('three');
    await leave('three', course.id);
    await sweeper.reconcileTeacher(teacherId, new Date());

    const gone = await prisma.classAttendance.findMany({
      where: { studentUserId: three, occurrence: { courseId: course.id, isActive: true } },
    });
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((line) => !line.isActive)).toBe(true);

    // Reopening a place is the same row becoming true again rather than a new line: the register of
    // a class is a list of people, and a person does not get a second name for coming back.
    await enroll(as('three'), course.id);
    await sweeper.reconcileTeacher(teacherId, new Date());

    const back = await prisma.classAttendance.findMany({
      where: { studentUserId: three, occurrence: { courseId: course.id, isActive: true } },
    });
    expect(back.every((line) => line.isActive)).toBe(true);
    expect(back.map((line) => line.id).sort()).toEqual(gone.map((line) => line.id).sort());
  });

  it('counts the names a class is standing for', async () => {
    const [row] = await seenTeaching(as('gen'));
    if (!row) throw new Error('A swept week came back with no classes.');

    const expected = await prisma.classAttendance.count({
      where: { occurrenceId: row.id, isActive: true },
    });
    expect(row.studentsExpected).toBe(expected);
    // The register and the roster say the same thing about a class that has not happened yet — which
    // is the whole reason the sweep revisits the lines it wrote, and not only the ones it missed.
    expect(expected).toBe(
      await prisma.enrollment.count({ where: { courseId: course.id, isActive: true } }),
    );
  });

  it('keeps a stranger’s series from writing classes onto somebody else’s calendar', async () => {
    // A series is only a sentence about a week until this sweep turns it into dated classes on a
    // named teacher's calendar — so scheduling one has to be scoped to the owner of the course it
    // speaks for, or a teacher could put lessons into a colleague's month.
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${course.id}/series`)
      .set('Authorization', `Bearer ${as('else')}`)
      .send({
        weekday: 6,
        startMinutes: START_MINUTES + WINDOW_MINUTES * 2,
        endMinutes: START_MINUTES + WINDOW_MINUTES * 3,
        durationMinutes: WINDOW_MINUTES,
      })
      .expect(404);

    expect(await prisma.classSeries.count({ where: { courseId: course.id } })).toBe(
      seriesIds.length,
    );
    expect((await rowsOf(course.id)).every((row) => row.teacherUserId === teacherId)).toBe(true);
  });

  it('takes the day off the calendar when the teacher marks it', async () => {
    const rows = await rowsOf(course.id, { isActive: true });
    const blocked = rows[3];
    if (!blocked) throw new Error('A month of daily classes came back with fewer than four.');

    const holidayId = await markDayOff(as('gen'), dayKey(blocked.startsAt));

    const after = await prisma.classOccurrence.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(after.isActive).toBe(false);
    expect((await seenTeaching(as('gen'))).some((entry) => entry.id === blocked.id)).toBe(false);

    await liftDayOff(as('gen'), holidayId);

    // The same row, not a new one: the class that comes back is the class that was paused, and the
    // names already written against it are still its names.
    const restored = await prisma.classOccurrence.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(restored.isActive).toBe(true);
    expect(restored.startsAt).toEqual(blocked.startsAt);
    expect((await seenTeaching(as('gen'))).some((entry) => entry.id === blocked.id)).toBe(true);
  });

  it('closes every class a retired series stood for', async () => {
    const seriesId = seriesAt(0);
    const before = await rowsOf(course.id, { seriesId, isActive: true });
    expect(before.length).toBeGreaterThan(0);

    await retireSeries(as('gen'), course.id, seriesId);

    expect(await prisma.classOccurrence.count({ where: { seriesId, isActive: true } })).toBe(0);
    // Nothing is thrown away. The rows that series made are still there, retired, and the register
    // beside each of them still resolves to a class.
    expect(await prisma.classOccurrence.count({ where: { seriesId } })).toBe(before.length);
  });

  it('leaves the classes that already happened alone', async () => {
    const past = new Date(Date.now() - 3 * MS_PER_DAY);
    past.setUTCHours(9, 0, 0, 0);

    const occurrence = await prisma.classOccurrence.create({
      data: {
        seriesId: seriesAt(1),
        courseId: course.id,
        teacherUserId: teacherId,
        startsAt: past,
        durationMinutes: WINDOW_MINUTES,
      },
    });
    const line = await prisma.classAttendance.create({
      data: { occurrenceId: occurrence.id, studentUserId: await named('one') },
    });
    await prisma.classAttendance.update({
      where: { id: line.id },
      data: { statusValueId: presentStatusId },
    });

    // A day off on that date, a series retired, and another sweep: none of them may reach a class
    // whose minute has gone by. What happened that Monday is a fact about that Monday.
    await markDayOff(as('gen'), dayKey(past));
    await retireSeries(as('gen'), course.id, seriesAt(1));
    await sweeper.reconcileTeacher(teacherId, new Date());

    expect(
      (await prisma.classOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } })).isActive,
    ).toBe(true);
    const marked = await prisma.classAttendance.findUniqueOrThrow({ where: { id: line.id } });
    expect(marked.statusValueId).toBe(presentStatusId);
    expect(marked.isActive).toBe(true);
  });

  it('is on the clock as well as on the writes', () => {
    expect(app.get(SchedulerRegistry).getCronJob('class-occurrence-generation')).toBeDefined();
  });
});

describe('the teacher’s dated calendar', () => {
  let course: { id: string; slug: string };
  let theirs: { id: string; slug: string };

  beforeAll(async () => {
    // A teacher with one course and a colleague with another: this list is read across every course
    // a teacher runs, so an owner whose calendar the suite has already filled would make "whose
    // class is this" unanswerable from the rows.
    course = await createPublishedCourse(as('thrd'), 'Taught');
    theirs = await createPublishedCourse(as('else'), 'Other');
    await scheduleWeek(as('thrd'), course.id);
    await scheduleWeek(as('else'), theirs.id);
  });

  it('answers the window it was asked for, soonest first', async () => {
    const from = new Date();
    const to = new Date(from.getTime() + 4 * MS_PER_DAY);

    const list = await seenTeaching(as('thrd'), { from, to });

    expect(list.length).toBeGreaterThan(0);
    for (const row of list) {
      expect(new Date(row.startsAt).getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(new Date(row.startsAt).getTime()).toBeLessThan(to.getTime());
    }
    expect(list.map((row) => new Date(row.startsAt).getTime())).toEqual(
      [...list.map((row) => new Date(row.startsAt).getTime())].sort((a, b) => a - b),
    );
  });

  it('refuses a window wider than the calendar is kept for', async () => {
    // Rows only exist inside the horizon the sweep fills, so a wider ask is not a bigger calendar: it
    // is a request to pull every class this teacher owns into one response.
    const from = new Date('2020-01-01T00:00:00.000Z');
    const at = (days: number) => new Date(from.getTime() + days * MS_PER_DAY);

    await teaching(as('thrd'), { from, to: at(HORIZON_DAYS) }).expect(200);
    await teaching(as('thrd'), { from, to: at(HORIZON_DAYS + 1) }).expect(400);
  });

  it('names the course, the hour and the number standing for it', async () => {
    const list = await seenTeaching(as('thrd'));
    const [row] = list;
    if (!row) throw new Error('A teacher with a scheduled week came back with no classes.');

    expect(Object.keys(row).sort()).toEqual([
      'course',
      'durationMinutes',
      'endsAt',
      'id',
      'seriesId',
      'startsAt',
      'studentsExpected',
    ]);
    expect(row.course).toEqual({
      id: course.id,
      slug: course.slug,
      title: expect.any(String),
    });
    expect(new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()).toBe(
      row.durationMinutes * 60_000,
    );
  });

  it('keeps another teacher’s classes off the list', async () => {
    const elsewhere = await prisma.classOccurrence.findFirstOrThrow({
      where: { courseId: theirs.id, isActive: true },
    });

    expect((await seenTeaching(as('thrd'))).some((entry) => entry.id === elsewhere.id)).toBe(false);
    expect((await seenTeaching(as('else'))).some((entry) => entry.id === elsewhere.id)).toBe(true);
  });

  it('is the teacher’s door only', async () => {
    await teaching(as('one')).expect(403);
    await teaching().expect(401);
  });
});

describe('the student’s classes', () => {
  let course: { id: string; slug: string };

  beforeAll(async () => {
    // `four` holds one place in the whole suite, so this list has exactly one course in it and a
    // row from anywhere else is the bug the test is looking for.
    //
    // The course is on `clear`, an account whose week has nothing written on it yet: a week is
    // scheduled at Monday 09:00 through Sunday 09:00 here, and since [[the clash guard]] a teacher
    // already standing for another course at those minutes could not open a second one on top.
    course = await createPublishedCourse(as('clear'), 'Cohort');
    await enroll(as('four'), course.id);
    await scheduleWeek(as('clear'), course.id);
  });

  it('lists the classes of a course they hold a place in', async () => {
    const list = await seenLearning(as('four'));

    expect(list.length).toBeGreaterThan(0);
    expect(list.every((entry) => entry.course.id === course.id)).toBe(true);
    expect(list.map((entry) => new Date(entry.startsAt).getTime())).toEqual(
      [...list.map((entry) => new Date(entry.startsAt).getTime())].sort((a, b) => a - b),
    );
  });

  it('says nothing about a class they were not standing for', async () => {
    // `fifth` holds no place anywhere in the suite: the list is read from a person's places, not
    // from a course, and a student with nothing to attend is answered with an empty month.
    expect(await seenLearning(as('fifth'))).toHaveLength(0);
  });

  it('refuses the window the teacher’s door refuses', async () => {
    const from = new Date('2020-01-01T00:00:00.000Z');
    const to = new Date(from.getTime() + (HORIZON_DAYS + 1) * MS_PER_DAY);

    await learning(as('four'), { from, to }).expect(400);
  });

  it('carries the student’s own mark, or nothing', async () => {
    const list = await seenLearning(as('four'));
    const [row] = list;
    if (!row) throw new Error('A student with a place came back with no classes.');

    expect(row.status).toBeNull();

    await prisma.classAttendance.update({
      where: {
        occurrenceId_studentUserId: { occurrenceId: row.id, studentUserId: await named('four') },
      },
      data: { statusValueId: presentStatusId },
    });

    const marked = (await seenLearning(as('four'))).find((entry) => entry.id === row.id);
    expect(marked?.status).toBe(ATTENDANCE_STATUS_CODES.PRESENT);
  });

  it('is the student’s door only', async () => {
    await learning(as('else')).expect(403);
    await learning().expect(401);
  });
});
