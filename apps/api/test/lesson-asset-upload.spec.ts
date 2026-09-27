import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * A teacher putting a recording on one of their pages.
 *
 * The order of the checks is the subject of this suite, because an upload is the only write in
 * the API that costs disk before it costs anything else. So: the person is authorised and the
 * page is theirs to write on *before a byte is read*, the file's type and size are refused
 * during the stream rather than after it, and nothing is filed as standing until the bytes have
 * landed. A refused upload must leave no row and no file — which is why the adapter clears away
 * a write that never finished, and why an oversized body is aborted at the cap instead of being
 * read to the end and then rejected.
 *
 * Then the rule the table cannot hold: one recording stands per lesson, and attaching the next
 * one retires the previous rather than deleting it. The old row and its bytes both survive —
 * what changes is which one a student is served.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

/** Small enough that the oversize test can beat it with a megabyte of buffer. */
const MAX_UPLOAD_MB = 1;
const CAP_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

let app: INestApplication;
let storageRoot: string;
const prisma = new PrismaClient();

async function tokenFor(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

async function register(name: string, role: 'teacher' | 'student'): Promise<void> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: 'Upload Test', role });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
}

let courseSequence = 0;

/** A live course with one module and one written, published page — a lesson worth recording. */
async function createLesson(token: string): Promise<string> {
  courseSequence += 1;
  const course = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Fractions, slowly',
      slug: `upload-${courseSequence}-${RUN}`,
      level: 'beginner',
    })
    .expect(201);
  const courseId = course.body.course.id as string;

  const module = await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Equivalent fractions' })
    .expect(201);
  const moduleId = module.body.module.id as string;

  const lesson = await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Why the denominator stays put',
      body: 'Start with one pie. Cut it twice.',
    })
    .expect(201);
  return lesson.body.lesson.id as string;
}

/** The routes are addressed through the lesson's own module, which these tests do not track. */
async function moduleOf(lessonId: string): Promise<string> {
  const lesson = await prisma.lesson.findFirstOrThrow({ where: { id: lessonId } });
  return lesson.moduleId;
}

/** Every path the store holds, sorted — so "nothing was written" is one comparison. */
async function filesOnDisk(): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, prefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  }
  try {
    await walk(storageRoot, '');
  } catch {
    // The directory is created by the first write, so a store nobody has used has no listing.
  }
  return found.sort();
}

describe('attaching a recording to a lesson', () => {
  let teacher: string;
  let otherTeacher: string;
  let student: string;

  beforeAll(async () => {
    await seedLookups(prisma);
    storageRoot = await mkdtemp(join(tmpdir(), 'lms-upload-'));
    process.env.STORAGE_LOCAL_DIR = storageRoot;
    process.env.MAX_UPLOAD_MB = String(MAX_UPLOAD_MB);
    app = await createTestApp({ imports: [AppModule] });

    await register('tessa.uploads', 'teacher');
    await register('rita.uploads', 'teacher');
    await register('sam.uploads', 'student');
    teacher = await tokenFor('tessa.uploads');
    otherTeacher = await tokenFor('rita.uploads');
    student = await tokenFor('sam.uploads');
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    const courseIds = (
      await prisma.course.findMany({
        where: { teacherUserId: { in: userIds } },
        select: { id: true },
      })
    ).map((row) => row.id);
    const moduleIds = (
      await prisma.module.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })
    ).map((row) => row.id);
    await prisma.lessonAsset.deleteMany({
      where: { lesson: { module: { courseId: { in: courseIds } } } },
    });
    await prisma.lesson.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('refuses to answer without a token', async () => {
    const lessonId = await createLesson(teacher);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .attach('file', Buffer.alloc(64, 7), { filename: 'a.mp4', contentType: 'video/mp4' })
      .expect(401);

    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('refuses a student the upload', async () => {
    const lessonId = await createLesson(teacher);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${student}`)
      .attach('file', Buffer.alloc(64, 7), { filename: 'a.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('stores the bytes the page was given and files the row that names them', async () => {
    const lessonId = await createLesson(teacher);
    const moduleId = await moduleOf(lessonId);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(2048, 7), {
        filename: 'cutting the pie.mp4',
        contentType: 'video/mp4',
      })
      .expect(201);

    expect(res.body.asset).toMatchObject({
      lessonId,
      displayName: 'cutting the pie.mp4',
      contentType: 'video/mp4',
      bytes: 2048,
    });
    // No internal path on the wire: the key is the store's business, and a client that knows it
    // would be looking for a URL that this design refuses to have.
    expect(res.body.asset.storedKey).toBeUndefined();

    const row = await prisma.lessonAsset.findFirstOrThrow({ where: { lessonId, isActive: true } });
    expect(await stat(join(storageRoot, row.storedKey))).toMatchObject({ size: 2048 });
    // Under the page's own directory, with a name nobody could guess from the lesson id.
    expect(row.storedKey.startsWith(`lessons/${lessonId}/`)).toBe(true);
    expect(row.storedKey.endsWith('.mp4')).toBe(true);
  });

  it("answers 404 for somebody else's page and writes nothing while it decides", async () => {
    const theirs = await createLesson(otherTeacher);
    const mine = await createLesson(teacher);
    const before = await filesOnDisk();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(theirs)}/lessons/${theirs}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(1024, 7), {
        filename: 'not-yours.mp4',
        contentType: 'video/mp4',
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    // The address is two hops, and a wrong first hop is the same answer: the module the route
    // names has to be the one the lesson is in.
    const crossed = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(mine)}/lessons/${theirs}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(1024, 7), { filename: 'crossed.mp4', contentType: 'video/mp4' });
    expect(crossed.status).toBe(404);

    expect(await filesOnDisk()).toEqual(before);
    expect(await prisma.lessonAsset.findFirst({ where: { lessonId: theirs } })).toBeNull();
  });

  it('refuses a file that is not one of the types a lesson can play', async () => {
    const lessonId = await createLesson(teacher);
    const before = await filesOnDisk();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /\n'), {
        filename: 'lecture-notes.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.file).toHaveLength(1);
    expect(await filesOnDisk()).toEqual(before);
  });

  it('stops a file that goes past the cap without reading the rest of it', async () => {
    const lessonId = await createLesson(teacher);
    const before = await filesOnDisk();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(CAP_BYTES + 512, 7), {
        filename: 'three-hour-lesson.mp4',
        contentType: 'video/mp4',
      });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.file).toContainEqual(
      expect.stringContaining(`${MAX_UPLOAD_MB} MB`),
    );

    // Nothing filed, and nothing left behind either: a write that was interrupted is not a
    // record of anything, and an orphan per attempt would be a way to fill the disk with
    // refusals.
    expect(await prisma.lessonAsset.findFirst({ where: { lessonId } })).toBeNull();
    expect(await filesOnDisk()).toEqual(before);
  });

  it('accepts a file up to the cap', async () => {
    const lessonId = await createLesson(teacher);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(CAP_BYTES, 7), {
        filename: 'exactly-the-cap.mp4',
        contentType: 'video/mp4',
      })
      .expect(201);

    expect(res.body.asset.bytes).toBe(CAP_BYTES);
  });

  it('replaces the standing recording and keeps the one it retired', async () => {
    const lessonId = await createLesson(teacher);
    const moduleId = await moduleOf(lessonId);

    const first = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(512, 7), { filename: 'take one.mp4', contentType: 'video/mp4' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(900, 1), { filename: 'take two.mp4', contentType: 'video/mp4' })
      .expect(201);

    expect(second.body.asset.id).not.toBe(first.body.asset.id);

    const retired = await prisma.lessonAsset.findUniqueOrThrow({
      where: { id: first.body.asset.id },
    });
    expect(retired.isActive).toBe(false);
    // The bytes of the take it replaced are still there — the page's history, and the reason
    // this is a flip rather than a remove.
    expect(await stat(join(storageRoot, retired.storedKey))).toMatchObject({ size: 512 });

    const standing = await request(app.getHttpServer())
      .get(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    expect(standing.body.asset).toMatchObject({
      id: second.body.asset.id,
      displayName: 'take two.mp4',
    });

    // and a third attempt finds one row to retire, not two: the flip is scoped to the standing
    // one, so a lesson never accumulates rows that all claim to be the current video.
    const actives = await prisma.lessonAsset.findMany({ where: { lessonId, isActive: true } });
    expect(actives.map((row) => row.id)).toEqual([second.body.asset.id]);
  });

  it('answers a page with nothing attached as an empty reading rather than a missing one', async () => {
    const lessonId = await createLesson(teacher);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);

    expect(res.body).toEqual({ asset: null });
  });

  it('refuses an upload with no file in it', async () => {
    const lessonId = await createLesson(teacher);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .field('title', 'I meant to attach something')
      .attach('other', Buffer.alloc(64, 7), {
        filename: 'wrong-box.mp4',
        contentType: 'video/mp4',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.file).toHaveLength(1);
  });

  it('keeps the name the teacher wrote and never lets it choose a path', async () => {
    const lessonId = await createLesson(teacher);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${await moduleOf(lessonId)}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(64, 7), {
        filename: '../../../../etc/passwd.mp4',
        contentType: 'video/mp4',
      })
      .expect(201);

    // Whatever the sender called it, the bytes land under the page's own directory with a uuid
    // for a name: a filename decides nothing about where anything goes, and even the extension
    // comes from the declared type rather than from the name.
    const row = await prisma.lessonAsset.findFirstOrThrow({ where: { lessonId, isActive: true } });
    expect(row.storedKey).toMatch(new RegExp(`^lessons/${lessonId}/[0-9a-f-]{36}\\.mp4$`));
    expect(await filesOnDisk()).toContain(row.storedKey);

    // The name itself is kept for the teacher to recognise their own file, and nothing in it
    // survives as a separator — a path-shaped string is only ever a name here.
    expect(res.body.asset.displayName).toBe('passwd.mp4');
  });

  it('will not put a recording on a page that is out of the syllabus', async () => {
    const lessonId = await createLesson(teacher);
    const moduleId = await moduleOf(lessonId);
    await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/deactivate`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(64, 7), { filename: 'orphan.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(404);
    expect(await filesOnDisk()).not.toContain(`lessons/${lessonId}/orphan.mp4`);
    // A retired page answers the same as one that never was, so the same refusal covers a
    // recording that would have been unreachable the moment it landed.
    expect(await prisma.lessonAsset.findFirst({ where: { lessonId } })).toBeNull();
  });

  it('answers a page that is not one of the teacher’s own, through either hop', async () => {
    const lessonId = await createLesson(teacher);
    const moduleId = await moduleOf(lessonId);

    // The route is two ids deep, and each of them has to be the pair they were minted as: a
    // module of mine and a lesson of yours is a 404, and so is the reverse.
    const strangerModule = randomUUID();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/modules/${strangerModule}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${teacher}`)
      .attach('file', Buffer.alloc(64, 7), {
        filename: 'wrong-parent.mp4',
        contentType: 'video/mp4',
      });
    expect(res.status).toBe(404);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
      .set('Authorization', `Bearer ${otherTeacher}`);
    expect(listed.status).toBe(404);
  });
});
