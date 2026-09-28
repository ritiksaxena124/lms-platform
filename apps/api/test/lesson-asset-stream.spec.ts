import { mkdtemp, rm } from 'node:fs/promises';
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
 * The teacher's own door onto the bytes they uploaded.
 *
 * The student's gate is the interesting one and lives in `lesson-video-stream.spec.ts`; this file
 * is about the other side, where the question is simply whose page it is. It exists because a
 * recording a teacher cannot watch is a recording they cannot check — and because the read route
 * has to be the same route for both audiences rather than a second way to the same key, which is
 * how a file ends up readable by somebody the write path would have refused.
 *
 * The one rule here that the upload suite cannot state is which recording a page plays: a lesson
 * keeps the takes it retired, and only one of them is standing.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

/** Two takes that are easy to tell apart by their bytes alone. */
const FIRST_TAKE = Buffer.from(Array.from({ length: 600 }, (_, i) => i % 97));
const SECOND_TAKE = Buffer.from(Array.from({ length: 900 }, (_, i) => i % 251));

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
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: 'Play Test', role })
    .expect(201);
}

let courseSequence = 0;

/** A page worth recording, addressed the way the asset routes address it: through its module. */
async function ownedLesson(token: string): Promise<{ moduleId: string; lessonId: string }> {
  courseSequence += 1;
  const course = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Fractions, slowly ${courseSequence} ${RUN}`,
      slug: `play-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'A first pass at the topic.',
      description: 'Start with one pie, end with adding any two fractions.',
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
    .send({ title: 'Why the denominator stays put', body: 'Start with one pie. Cut it twice.' })
    .expect(201);
  return { moduleId, lessonId: lesson.body.lesson.id as string };
}

async function upload(
  address: { moduleId: string; lessonId: string },
  token: string,
  body: Buffer,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/v1/modules/${address.moduleId}/lessons/${address.lessonId}/asset`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', body, { filename: 'take.mp4', contentType: 'video/mp4' })
    .expect(201);
}

function play(
  address: { moduleId: string; lessonId: string },
  token?: string,
  range?: string,
): request.Test {
  const call = request(app.getHttpServer())
    .get(`/api/v1/modules/${address.moduleId}/lessons/${address.lessonId}/asset/video`)
    .responseType('arraybuffer')
    .buffer(true);
  if (token) call.set('Authorization', `Bearer ${token}`);
  if (range) call.set('Range', range);
  return call;
}

/** The same route read as JSON, which is the only way a refusal can be seen: a buffer asked for
 * as bytes never parses the error envelope the gate answers with. */
function refusal(address: { moduleId: string; lessonId: string }, token?: string): request.Test {
  const call = request(app.getHttpServer()).get(
    `/api/v1/modules/${address.moduleId}/lessons/${address.lessonId}/asset/video`,
  );
  if (token) call.set('Authorization', `Bearer ${token}`);
  return call;
}

function failureShape(body: Record<string, unknown>) {
  return { statusCode: body.statusCode, code: body.code, message: body.message };
}

describe('a teacher playing back their own recording', () => {
  let teacher: string;
  let otherTeacher: string;
  let student: string;

  beforeAll(async () => {
    await seedLookups(prisma);
    storageRoot = await mkdtemp(join(tmpdir(), 'lms-play-'));
    process.env.STORAGE_LOCAL_DIR = storageRoot;
    app = await createTestApp({ imports: [AppModule] });

    await register('tessa.play', 'teacher');
    await register('rita.play', 'teacher');
    await register('sam.play', 'student');
    teacher = await tokenFor('tessa.play');
    otherTeacher = await tokenFor('rita.play');
    student = await tokenFor('sam.play');
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
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('hands the teacher the file they uploaded, and a piece of it when asked', async () => {
    const address = await ownedLesson(teacher);
    await upload(address, teacher, SECOND_TAKE);

    const whole = await play(address, teacher).expect(200);
    expect(whole.body).toEqual(SECOND_TAKE);
    expect(whole.headers['content-type']).toContain('video/mp4');
    expect(whole.headers['accept-ranges']).toBe('bytes');

    const piece = await play(address, teacher, 'bytes=4-11').expect(206);
    expect(piece.body).toEqual(SECOND_TAKE.subarray(4, 12));
    expect(piece.headers['content-range']).toBe(`bytes 4-11/${SECOND_TAKE.length}`);
  });

  it('plays the standing take, not the one it replaced', async () => {
    const address = await ownedLesson(teacher);
    await upload(address, teacher, FIRST_TAKE);
    await upload(address, teacher, SECOND_TAKE);

    const res = await play(address, teacher).expect(200);

    // The retired row still names bytes that are still on disk — that is the record of what the
    // teacher uploaded before — and none of them are what a page plays.
    expect(res.body).toEqual(SECOND_TAKE);
    expect(res.headers['content-length']).toBe(String(SECOND_TAKE.length));
  });

  it('answers another teacher the way it answers a page that never was', async () => {
    const address = await ownedLesson(teacher);
    await upload(address, teacher, SECOND_TAKE);

    const notYours = await refusal(address, otherTeacher).expect(404);
    const invented = await refusal(
      { moduleId: randomUUID(), lessonId: randomUUID() },
      otherTeacher,
    ).expect(404);

    expect(failureShape(notYours.body)).toEqual(failureShape(invented.body));
    expect(notYours.body.code).toBe('NOT_FOUND');
    // A refusal that streamed would be a gate that only checks the status line. Here the answer
    // is the envelope, and no range header is on its way.
    expect(notYours.headers['content-type']).toContain('application/json');
    expect(notYours.headers['content-range']).toBeUndefined();
  });

  it('refuses a student before it reads a byte, whatever their enrollment says', async () => {
    const address = await ownedLesson(teacher);
    await upload(address, teacher, SECOND_TAKE);

    const res = await refusal(address, student).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('says there is no recording on a page that has none', async () => {
    const address = await ownedLesson(teacher);

    const res = await refusal(address, teacher).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('We cannot find that recording.');
  });
});
