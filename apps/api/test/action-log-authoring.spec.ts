import type { INestApplication } from '@nestjs/common';
import type { ActionLog } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTION_SECTION_CODES, ACTION_TARGET_TABLE_CODES } from '@lms/shared';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The authoring writes, each filing its own record.
 *
 * 7b proved the recorder over three invented routes; this proves the real ones. The claim worth the
 * file is that a teacher's syllabus edits leave a row behind *without the portal, the controller or
 * the DTO knowing the log exists* — so every assertion here is made by pressing an endpoint the
 * teacher portal presses and then reading `action_log`, and the interesting half of each test is
 * what the row does not say.
 *
 * Two rules decide what a row looks like, and both come from 7a: a row is earned by a write that
 * changed something, so a second press of a switch that was already where the teacher wants it files
 * nothing, and a request that was refused files nothing either. And `detail` holds the decision
 * rather than the content, so an edit names the fields that moved and never what they were changed
 * to — the course row answers that better every year, and a log that answers it differently is a log
 * nobody can trust after the first rename.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma: PrismaClient = new PrismaClient();
let teacherId = '';
let storageRoot: string;

/** A teacher owns one slug per address, so each course in a test needs its own. */
let slugSequence = 0;
const uniqueSlug = (stem: string) => `${stem}-${RUN}-${(slugSequence += 1)}`;

/** Sign in once per person and keep the token. `/auth/login` is throttled far below the 120
 * requests a minute this file's helpers would otherwise spend, and a suite that exhausted it
 * would report the throttle rather than the log. */
const tokens = new Map<string, string>();

async function bearer(name: string): Promise<string> {
  const cached = tokens.get(name);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  tokens.set(name, res.body.accessToken as string);
  return res.body.accessToken as string;
}

/** One press, and the rows it filed — which is the pair the phase is about, so the helpers return
 * both rather than making a test re-read the response for a request id. */
async function press(
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  body?: object,
): Promise<{ res: request.Response; rows: ActionLog[] }> {
  const token = await bearer('tessa');
  const call = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('Authorization', `Bearer ${token}`);
  // `expect(fn)` hands the callback the whole Response, not the status, and fails only if the
  // callback throws — so the assertion has to be written as one.
  const res = await (body === undefined ? call : call.send(body)).expect((response) => {
    if (response.status < 200 || response.status > 299) {
      throw new Error(
        `${method.toUpperCase()} ${path} answered ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
  });
  return { res, rows: await filedBy(res.headers['x-request-id'] as string) };
}

const filedBy = (requestId: string): Promise<ActionLog[]> =>
  prisma.actionLog.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });

/** The one row a press filed, or a failure naming every row it filed.
 * Tests in this file are about a single write, so the count is part of the claim — and reading the
 * rows is more useful than reading `expected undefined to equal ...`. */
function onlyRow(rows: ActionLog[]): ActionLog {
  const [row] = rows;
  if (!row || rows.length !== 1) {
    throw new Error(`Expected exactly one record, got: ${JSON.stringify(rows)}`);
  }
  return row;
}

const shape = (row: ActionLog) => `${row.sectionCode}/${row.targetTable}/${row.actorKind}`;
const described = (rows: ActionLog[]) =>
  rows.map((row) => `${row.actionCode} ${JSON.stringify(row.detail)}`);

async function createCourse(title = 'Fractions, slowly'): Promise<string> {
  const token = await bearer('tessa');
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, slug: uniqueSlug('fractions'), level: 'beginner' })
    .expect(201);
  return res.body.course.id as string;
}

/** Setup, not a claim: these return the id and leave the rows they file unread, so a test that
 * asserts about one write can start from a syllabus without also asserting about the writes that
 * built it. */
async function makeModule(courseId: string, title: string): Promise<string> {
  const token = await bearer('tessa');
  const res = await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title })
    .expect(201);
  return res.body.module.id as string;
}

async function makeLesson(
  moduleId: string,
  columns: { title?: string; body?: string } = {},
): Promise<string> {
  const token = await bearer('tessa');
  const res = await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: columns.title ?? 'Cutting a cake into six', ...columns })
    .expect(201);
  return res.body.lesson.id as string;
}

/** The upload route is multipart, so it is not a `press`; the pair it returns is the same one. */
async function upload(
  moduleId: string,
  lessonId: string,
  bytes: number,
  filename: string,
): Promise<{ res: request.Response; rows: ActionLog[] }> {
  const token = await bearer('tessa');
  const res = await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.alloc(bytes, 7), { filename, contentType: 'video/mp4' })
    .expect(201);
  return { res, rows: await filedBy(res.headers['x-request-id'] as string) };
}

beforeAll(async () => {
  await seedLookups(prisma);
  // A temp store, so a recording filed here cannot land in the dev directory the teacher portal
  // reads from.
  storageRoot = await mkdtemp(join(tmpdir(), 'lms-action-log-'));
  process.env.STORAGE_LOCAL_DIR = storageRoot;
  app = await createTestApp({ imports: [AppModule] });

  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email: emailFor('tessa'),
      password: PASSWORD,
      fullName: 'Tessa Person',
      role: 'teacher',
    })
    .expect(201);
  teacherId = (await prisma.user.findFirstOrThrow({ where: { email: emailFor('tessa') } })).id;
});

afterAll(async () => {
  await app?.close();

  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((user) => user.id);
  const courseIds = (
    await prisma.course.findMany({
      where: { teacherUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((course) => course.id);
  const moduleIds = (
    await prisma.module.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })
  ).map((row) => row.id);
  const lessonIds = (
    await prisma.lesson.findMany({ where: { moduleId: { in: moduleIds } }, select: { id: true } })
  ).map((row) => row.id);

  // Children before parents, and the record of a write goes first of all: every relation this file
  // touches is restricted, so an account cannot be deleted under a log that names it, and a teacher
  // cannot be deleted under the course they wrote.
  await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.lessonAsset.deleteMany({ where: { lessonId: { in: lessonIds } } });
  await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } });
  await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.availabilityRule.deleteMany({ where: { teacherUserId: { in: userIds } } });
  await prisma.teacherSubject.deleteMany({
    where: { profile: { userId: { in: userIds } } },
  });
  await prisma.teacherProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

describe('the course a teacher writes', () => {
  it('files the create, and then the edit that names what moved', async () => {
    const created = await press('post', '/courses', {
      title: 'Algebra backwards',
      slug: uniqueSlug('algebra'),
      level: 'beginner',
    });

    const row = onlyRow(created.rows);
    expect(row).toMatchObject({
      actionCode: 'course_created',
      sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
      targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
      targetId: created.res.body.course.id,
      actorKind: 'user',
      actorUserId: teacherId,
      actorRoleCode: 'teacher',
      requestId: created.res.headers['x-request-id'],
    });
    // Nothing was decided at a create that the row does not already say.
    expect(row.detail).toEqual({});

    const edited = await press('patch', `/courses/${created.res.body.course.id}`, {
      summary: 'Ten years of board papers, worked backwards.',
      title: 'Algebra, backwards',
    });

    expect(described(edited.rows)).toEqual(['course_updated {"changed":"summary,title"}']);
    expect(onlyRow(edited.rows).detail).toEqual({ changed: 'summary,title' });
    // The content stays out of the record: what the title became is on the course row, and a log
    // holding the old one would be the second copy that somebody later has to reconcile.
    expect(JSON.stringify(onlyRow(edited.rows).detail)).not.toMatch(/board papers|backwards/);
  });

  it('files a price as one field moving, not as two columns', async () => {
    const courseId = await createCourse();
    const priced = await press('patch', `/courses/${courseId}`, {
      price: { minorUnits: 3900, currency: 'INR' },
    });

    expect(onlyRow(priced.rows).detail).toEqual({ changed: 'price' });

    const cleared = await press('patch', `/courses/${courseId}`, { price: null });
    expect(onlyRow(cleared.rows).detail).toEqual({ changed: 'price' });
  });

  it('files each lifecycle move as the transition it was', async () => {
    const courseId = await createCourse();
    await press('patch', `/courses/${courseId}`, {
      summary: 'Worked from the marking scheme backwards.',
      description: 'Every chapter starts with the questions that actually appeared.',
    });

    const published = await press('post', `/courses/${courseId}/publish`);
    expect(onlyRow(published.rows)).toMatchObject({
      actionCode: 'course_published',
      targetId: courseId,
      detail: { from: 'draft', to: 'published' },
    });

    const archived = await press('post', `/courses/${courseId}/archive`);
    expect(onlyRow(archived.rows)).toMatchObject({
      actionCode: 'course_archived',
      detail: { from: 'published', to: 'archived' },
    });
  });

  it('files the switch that moved and not the one that did not', async () => {
    const courseId = await createCourse();

    const opened = await press('post', `/courses/${courseId}/demo-bookings`, { enabled: true });
    expect(onlyRow(opened.rows)).toMatchObject({
      actionCode: 'course_demo_bookings_changed',
      targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
      detail: { from: false, to: true },
    });

    // The same press again: the portal's response can be lost on the way home, and the teacher who
    // presses twice must not get a log that says they changed their mind twice.
    const repeated = await press('post', `/courses/${courseId}/demo-bookings`, { enabled: true });
    expect(repeated.rows).toEqual([]);

    const closed = await press('post', `/courses/${courseId}/demo-bookings`, { enabled: false });
    expect(onlyRow(closed.rows).detail).toEqual({ from: true, to: false });
  });

  it('files nothing for a write that was refused, or for a patch that said nothing', async () => {
    const courseId = await createCourse();
    const before = await prisma.actionLog.count({ where: { targetId: courseId } });

    // An empty body is a successful no-op: the course is unchanged, so there is no decision to
    // record, and a row here would count as an edit nobody made.
    await press('patch', `/courses/${courseId}`, {});

    const token = await bearer('tessa');
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(await prisma.actionLog.count({ where: { targetId: courseId } })).toBe(before);
  });

  it('files an edit of somebody else’s course as the nothing it was', async () => {
    const courseId = await createCourse();
    const before = await prisma.actionLog.count({ where: { targetId: courseId } });

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: emailFor('morgan'),
        password: PASSWORD,
        fullName: 'Morgan Person',
        role: 'teacher',
      })
      .expect(201);
    const otherToken = await bearer('morgan');
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Not theirs' })
      .expect(404);

    // The refused request still has a row-count to answer for: nothing was written, so the log has
    // to stay empty even though a teacher's id was in the request and an action name was in the body.
    expect(await prisma.actionLog.count({ where: { targetId: courseId } })).toBe(before);
    expect(
      await prisma.actionLog.count({ where: { requestId: res.headers['x-request-id'] } }),
    ).toBe(0);
  });
});

describe('the syllabus inside a course', () => {
  it('files a block as the module it made, not as the course that holds it', async () => {
    const courseId = await createCourse();
    const created = await press('post', `/courses/${courseId}/modules`, {
      title: 'Unit 1 — Fractions of a whole',
    });

    expect(onlyRow(created.rows)).toMatchObject({
      actionCode: 'course_module_created',
      sectionCode: ACTION_SECTION_CODES.COURSE_AUTHORING,
      targetTable: ACTION_TARGET_TABLE_CODES.MODULE,
      targetId: created.res.body.module.id,
      actorUserId: teacherId,
      detail: {},
    });
    // The block's number is not a decision worth a record: it follows from how many blocks the
    // course already had, and `targetId` names the row that holds it.
    expect(onlyRow(created.rows).detail).not.toHaveProperty('position');
    // And the three derived columns come from the action name, not from this caller: the route
    // that filed the record never mentioned a section, a table or an actor kind.
    expect(shape(onlyRow(created.rows))).toBe('course_authoring/module/user');
  });

  it('files the rename by what moved, and files nothing when nothing did', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Unit 1');

    const renamed = await press('patch', `/courses/${courseId}/modules/${moduleId}`, {
      title: 'Unit 1 — Fractions of a whole',
      summary: 'Sharing before the notation arrives.',
    });
    expect(described(renamed.rows)).toEqual(['course_module_updated {"changed":"summary,title"}']);

    // The same body again: the form posts every box it showed, so a patch that lists the title
    // the block already carries is a teacher saving rather than changing.
    const repeated = await press('patch', `/courses/${courseId}/modules/${moduleId}`, {
      title: 'Unit 1 — Fractions of a whole',
      summary: 'Sharing before the notation arrives.',
    });
    expect(repeated.rows).toEqual([]);
  });

  it('files a reorder against the course whose order changed, once', async () => {
    const courseId = await createCourse();
    const first = await makeModule(courseId, 'Unit 1');
    const second = await makeModule(courseId, 'Unit 2');
    const third = await makeModule(courseId, 'Unit 3');

    // Only the last two swap, so the row count is the arithmetic of the press rather than the
    // number of blocks the teacher sent.
    const swapped = await press('post', `/courses/${courseId}/modules/reorder`, {
      moduleIds: [first, third, second],
    });
    expect(onlyRow(swapped.rows)).toMatchObject({
      actionCode: 'course_modules_reordered',
      targetTable: ACTION_TARGET_TABLE_CODES.COURSE,
      targetId: courseId,
      detail: { moved: 2 },
    });

    // The order the course already has, sent back to it: nothing moved, so the press that
    // arrived twice from a lost response files one row at most — here, none.
    const idempotent = await press('post', `/courses/${courseId}/modules/reorder`, {
      moduleIds: [first, third, second],
    });
    expect(idempotent.rows).toEqual([]);
  });

  it('files a block taken out of the syllabus, and nothing for a refusal', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Added by mistake');

    const removed = await press('post', `/courses/${courseId}/modules/${moduleId}/deactivate`);
    expect(onlyRow(removed.rows)).toMatchObject({
      actionCode: 'course_module_deactivated',
      targetTable: ACTION_TARGET_TABLE_CODES.MODULE,
      targetId: moduleId,
      detail: {},
    });

    // The block is gone from the syllabus, so the second press is a 404 rather than a second
    // removal — and a refused request still owes the log an empty answer.
    const before = await prisma.actionLog.count({ where: { targetId: moduleId } });
    const token = await bearer('tessa');
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/modules/${moduleId}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(await prisma.actionLog.count({ where: { targetId: moduleId } })).toBe(before);
  });
});

describe('the pages inside a block', () => {
  it('files a page as the lesson it made and marks the preview it opens', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Unit 1');

    const created = await press('post', `/modules/${moduleId}/lessons`, {
      title: 'Cutting a cake into six',
    });
    expect(onlyRow(created.rows)).toMatchObject({
      actionCode: 'lesson_created',
      targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
      targetId: created.res.body.lesson.id,
      detail: {},
    });

    const opened = await press(
      'patch',
      `/modules/${moduleId}/lessons/${created.res.body.lesson.id}`,
      {
        isFreePreview: true,
      },
    );
    expect(described(opened.rows)).toEqual(['lesson_updated {"changed":"isFreePreview"}']);

    const repeated = await press(
      'patch',
      `/modules/${moduleId}/lessons/${created.res.body.lesson.id}`,
      {
        isFreePreview: true,
      },
    );
    expect(repeated.rows).toEqual([]);
  });

  it('files publishing and taking back as the two transitions they are', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Unit 1');
    const lessonId = await makeLesson(moduleId, {
      body: 'Six pieces, and the word for one of them.',
    });

    const published = await press('post', `/modules/${moduleId}/lessons/${lessonId}/publish`);
    expect(onlyRow(published.rows)).toMatchObject({
      actionCode: 'lesson_published',
      targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
      targetId: lessonId,
      detail: { from: 'draft', to: 'published' },
    });

    const returned = await press('post', `/modules/${moduleId}/lessons/${lessonId}/unpublish`);
    expect(onlyRow(returned.rows)).toMatchObject({
      actionCode: 'lesson_unpublished',
      detail: { from: 'published', to: 'draft' },
    });

    // A page with nothing written on it cannot be published, and the refusal is not a decision.
    const emptyId = await makeLesson(moduleId, { title: 'Equivalent fractions' });
    const token = await bearer('tessa');
    const before = await prisma.actionLog.count({ where: { targetId: emptyId } });
    await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${emptyId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(await prisma.actionLog.count({ where: { targetId: emptyId } })).toBe(before);
  });

  it('files a page moved between blocks as one field moving, not as a position', async () => {
    const courseId = await createCourse();
    const first = await makeModule(courseId, 'Unit 1');
    const second = await makeModule(courseId, 'Unit 2');
    const lessonId = await makeLesson(first, { title: 'Sharing it fairly' });

    const moved = await press('patch', `/modules/${first}/lessons/${lessonId}`, {
      moduleId: second,
    });
    expect(onlyRow(moved.rows)).toMatchObject({
      actionCode: 'lesson_updated',
      targetId: lessonId,
      detail: { changed: 'module' },
    });

    // Back where it came from, filed again: the block a page sits in is a decision, and the
    // number it took in the new one is arithmetic the log has no reason to duplicate.
    const back = await press('patch', `/modules/${second}/lessons/${lessonId}`, {
      moduleId: first,
    });
    expect(described(back.rows)).toEqual(['lesson_updated {"changed":"module"}']);
  });

  it('files a page reorder against the block, and a page taken out of it', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Unit 1');
    const one = await makeLesson(moduleId, { title: 'Halves and quarters' });
    const two = await makeLesson(moduleId, { title: 'Sixths and thirds' });
    const three = await makeLesson(moduleId, { title: 'Equivalent fractions' });

    const reversed = await press('post', `/modules/${moduleId}/lessons/reorder`, {
      lessonIds: [three, two, one],
    });
    expect(onlyRow(reversed.rows)).toMatchObject({
      actionCode: 'lessons_reordered',
      targetTable: ACTION_TARGET_TABLE_CODES.MODULE,
      targetId: moduleId,
      detail: { moved: 2 },
    });

    const unchanged = await press('post', `/modules/${moduleId}/lessons/reorder`, {
      lessonIds: [three, two, one],
    });
    expect(unchanged.rows).toEqual([]);

    const removed = await press('post', `/modules/${moduleId}/lessons/${one}/deactivate`);
    expect(onlyRow(removed.rows)).toMatchObject({
      actionCode: 'lesson_deactivated',
      targetTable: ACTION_TARGET_TABLE_CODES.LESSON,
      targetId: one,
      detail: {},
    });
  });

  it('files an edit of another teacher’s page as the nothing it was', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Unit 1');
    const lessonId = await makeLesson(moduleId, { title: 'Quarters' });
    const filedSoFar = await prisma.actionLog.count({ where: { targetId: lessonId } });

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: emailFor('priya'),
        password: PASSWORD,
        fullName: 'Priya Person',
        role: 'teacher',
      })
      .expect(201);
    const otherToken = await bearer('priya');
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/modules/${moduleId}/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Not theirs' })
      .expect(404);

    expect(await prisma.actionLog.count({ where: { targetId: lessonId } })).toBe(filedSoFar);
    expect(
      await prisma.actionLog.count({ where: { requestId: res.headers['x-request-id'] } }),
    ).toBe(0);
  });
});

describe('the recording on a page', () => {
  it('files the bytes that landed, and whether they replaced a standing take', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Unit 1');
    const lessonId = await makeLesson(moduleId, { body: 'Two pies, four pieces each.' });

    const first = await upload(moduleId, lessonId, 2048, 'cutting-the-pie.mp4');
    const row = onlyRow(first.rows);
    expect(row).toMatchObject({
      actionCode: 'lesson_asset_attached',
      sectionCode: ACTION_SECTION_CODES.LESSON_MEDIA,
      targetTable: ACTION_TARGET_TABLE_CODES.LESSON_ASSET,
      targetId: first.res.body.asset.id,
      actorUserId: teacherId,
    });
    expect(shape(row)).toBe('lesson_media/lesson_asset/user');
    expect(row.detail).toEqual({ bytes: 2048, contentType: 'video/mp4', replaced: false });

    const second = await upload(moduleId, lessonId, 900, 'take-two.mp4');
    expect(onlyRow(second.rows).detail).toEqual({
      bytes: 900,
      contentType: 'video/mp4',
      replaced: true,
    });

    // The name the file arrived with is what the teacher's finder called it, not what they
    // decided: it is on the asset row for them to read, and a record of the decision that
    // contained it would be a log full of other people's filenames.
    expect(JSON.stringify(second.rows)).not.toMatch(/take-two|cutting-the-pie/);
  });

  it('files nothing for an upload it refused on the way in', async () => {
    const courseId = await createCourse();
    const moduleId = await makeModule(courseId, 'Unit 1');
    const lessonId = await makeLesson(moduleId, { body: 'Six pieces, one word.' });

    const token = await bearer('tessa');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('#!/bin/sh\n'), {
        filename: 'lecture-notes.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);

    // Only this request's own rows: the suites run in parallel forks against the same test
    // database, so a count of the whole table would be a race with someone else's writes.
    expect(
      await prisma.actionLog.count({ where: { requestId: res.headers['x-request-id'] } }),
    ).toBe(0);
  });
});

describe('what a teacher says about their teaching', () => {
  const PROFILE = {
    headline: 'CBSE and IB maths, ten years of board batches',
    bio: 'I teach from the syllabus outward.',
    subjects: ['mathematics', 'physics'],
    timezone: 'Asia/Kolkata',
    hourlyRateMinorUnits: 120000,
    currency: 'INR',
  };

  it('files the first save as the whole document it wrote', async () => {
    const saved = await press('put', '/teacher/profile', PROFILE);
    const row = onlyRow(saved.rows);

    expect(row).toMatchObject({
      actionCode: 'teacher_profile_saved',
      sectionCode: ACTION_SECTION_CODES.TEACHER_PROFILE,
      targetTable: ACTION_TARGET_TABLE_CODES.TEACHER_PROFILE,
      actorUserId: teacherId,
      actorRoleCode: 'teacher',
    });
    // `rate` is one field over two columns, and `timezone` is a field of the document even though
    // the account carries the column — the teacher made one decision, so one name moves.
    expect(described(saved.rows)).toEqual([
      'teacher_profile_saved {"changed":"bio,headline,rate,subjects,timezone"}',
    ]);

    const profile = await prisma.teacherProfile.findFirstOrThrow({ where: { userId: teacherId } });
    expect(row.targetId).toBe(profile.id);
    expect(JSON.stringify(row.detail)).not.toMatch(/CBSE|syllabus outward/);
  });

  it('files only the field that moved, and nothing for a save that repeated itself', async () => {
    const renamed = await press('put', '/teacher/profile', {
      ...PROFILE,
      headline: 'CBSE maths, ten years of board batches',
    });
    expect(onlyRow(renamed.rows).detail).toEqual({ changed: 'headline' });

    // The same document posted again from a form that shows what it loaded.
    const repeated = await press('put', '/teacher/profile', {
      ...PROFILE,
      headline: 'CBSE maths, ten years of board batches',
    });
    expect(repeated.rows).toEqual([]);

    // The zone alone: it is written on the account, and it is still this save's decision, so the
    // record and both rows commit as one write.
    const moved = await press('put', '/teacher/profile', {
      ...PROFILE,
      headline: 'CBSE maths, ten years of board batches',
      timezone: 'Europe/London',
    });
    expect(onlyRow(moved.rows).detail).toEqual({ changed: 'timezone' });
    const user = await prisma.user.findFirstOrThrow({ where: { id: teacherId } });
    expect(user.timezone).toBe('Europe/London');
  });

  it('files a subject list and a rate as one field each', async () => {
    // What stands here is both subjects, from the saves before it. The order a teacher pasted them
    // in is not a decision, so the same two in the other order file nothing at all.
    const reordered = await press('put', '/teacher/profile', {
      ...PROFILE,
      headline: 'CBSE maths, ten years of board batches',
      timezone: 'Europe/London',
      subjects: ['physics', 'mathematics'],
    });
    expect(reordered.rows).toEqual([]);

    const dropped = await press('put', '/teacher/profile', {
      ...PROFILE,
      headline: 'CBSE maths, ten years of board batches',
      timezone: 'Europe/London',
      subjects: ['mathematics'],
    });
    expect(onlyRow(dropped.rows).detail).toEqual({ changed: 'subjects' });

    const repriced = await press('put', '/teacher/profile', {
      ...PROFILE,
      headline: 'CBSE maths, ten years of board batches',
      timezone: 'Europe/London',
      subjects: ['mathematics'],
      hourlyRateMinorUnits: 150000,
    });
    expect(onlyRow(repriced.rows).detail).toEqual({ changed: 'rate' });
  });

  it('files nothing for a save that named a subject the catalogue does not have', async () => {
    const token = await bearer('tessa');
    const res = await request(app.getHttpServer())
      .put('/api/v1/teacher/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...PROFILE, subjects: ['astrology'] })
      .expect(400);

    expect(
      await prisma.actionLog.count({ where: { requestId: res.headers['x-request-id'] } }),
    ).toBe(0);
  });
});

describe('the week a teacher opens', () => {
  const MONDAY_MORNING = { weekday: 1, startMinutes: 540, endMinutes: 600, slotMinutes: 30 };
  const TUESDAY_MORNING = { weekday: 2, startMinutes: 540, endMinutes: 600, slotMinutes: 30 };

  it('files a window as the rule it opened and a closing as the flag it moved', async () => {
    const created = await press('post', '/availability/rules', MONDAY_MORNING);
    const row = onlyRow(created.rows);
    expect(row).toMatchObject({
      actionCode: 'availability_rule_created',
      sectionCode: ACTION_SECTION_CODES.AVAILABILITY,
      targetTable: ACTION_TARGET_TABLE_CODES.AVAILABILITY_RULE,
      targetId: created.res.body.rule.id,
      actorUserId: teacherId,
    });
    expect(shape(row)).toBe('availability/availability_rule/user');
    // The four numbers are the row, so they stay out of the record.
    expect(row.detail).toEqual({});

    const retired = await press('post', `/availability/rules/${created.res.body.rule.id}/retire`);
    expect(onlyRow(retired.rows)).toMatchObject({
      actionCode: 'availability_rule_retired',
      targetId: created.res.body.rule.id,
      detail: {},
    });

    // A window already closed cannot close again, and the refusal is not a second decision.
    const token = await bearer('tessa');
    const again = await request(app.getHttpServer())
      .post(`/api/v1/availability/rules/${created.res.body.rule.id}/retire`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(
      await prisma.actionLog.count({ where: { requestId: again.headers['x-request-id'] } }),
    ).toBe(0);
  });

  it('files a window edit by the numbers that moved', async () => {
    const created = await press('post', '/availability/rules', TUESDAY_MORNING);
    const ruleId = created.res.body.rule.id as string;

    const widened = await press('patch', `/availability/rules/${ruleId}`, { endMinutes: 660 });
    expect(onlyRow(widened.rows)).toMatchObject({
      actionCode: 'availability_rule_updated',
      targetId: ruleId,
      detail: { changed: 'endMinutes' },
    });

    // The whole window sent back at the minutes it already holds: a form posts four boxes, and a
    // save that moved none of them decided nothing.
    const same = await press('patch', `/availability/rules/${ruleId}`, {
      weekday: 2,
      startMinutes: 540,
      endMinutes: 660,
      slotMinutes: 30,
    });
    expect(same.rows).toEqual([]);

    const shortened = await press('patch', `/availability/rules/${ruleId}`, {
      startMinutes: 570,
      slotMinutes: 45,
    });
    expect(onlyRow(shortened.rows).detail).toEqual({ changed: 'slotMinutes,startMinutes' });
  });

  it('files nothing for a window that walks into another one', async () => {
    const WEDNESDAY_MORNING = { ...MONDAY_MORNING, weekday: 3 };
    const created = await press('post', '/availability/rules', WEDNESDAY_MORNING);
    const ruleId = created.res.body.rule.id as string;

    const token = await bearer('tessa');
    const clash = await request(app.getHttpServer())
      .post('/api/v1/availability/rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...WEDNESDAY_MORNING, startMinutes: 570, endMinutes: 630 })
      .expect(409);

    // The refused create filed nothing, and the window it collided with still has only the one
    // record the create that made it left behind.
    expect(
      await prisma.actionLog.count({ where: { requestId: clash.headers['x-request-id'] } }),
    ).toBe(0);
    expect(await prisma.actionLog.count({ where: { targetId: ruleId } })).toBe(1);
  });
});
