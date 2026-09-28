import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
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
 * The gate on a recorded lesson, and the pieces a player asks it for.
 *
 * A recording is the paid part of this product. The page it belongs to already has two doors —
 * the teacher marked it free, or the reader holds a place in the course (§12) — and the video has
 * to answer to exactly those two and to nothing subtler, because the bytes are the thing somebody
 * paid for rather than the text around them. So the first tests here are the same refusals the
 * catalog makes elsewhere, asked of a route that answers with a file: the answer for "locked",
 * "draft" and "never written" is one 404 with no bytes in it.
 *
 * The rest is the range. A `<video>` element does not download a file, it *seeks* — it asks for
 * the first thousand bytes to find the header, then whatever window is under the scrubber, and a
 * server that ignores `Range` and answers `200` with the whole recording makes seeking either
 * broken or a way to fetch a two-hour lesson four times over. Honouring it is a contract with
 * precise numbers in it, which is why the assertions below are about `Content-Range` as much as
 * about the bytes themselves: the player positions itself against what the server said the file
 * is, and a wrong total is a seek bar that jumps.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

const TOTAL = 1000;
/** Every byte says where it sits, so a slice can be recognised rather than merely counted. */
const patterned = (length: number) => Buffer.from(Array.from({ length }, (_, i) => i % 251));
const VIDEO = patterned(TOTAL);

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
    .send({ email: emailFor(name), password: PASSWORD, fullName: 'Stream Test', role })
    .expect(201);
}

let courseSequence = 0;

async function createCourse(token: string, publish = true): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Fractions, slowly ${courseSequence} ${RUN}`,
      slug: `stream-${courseSequence}-${RUN}`,
      level: 'beginner',
      summary: 'A first pass at the topic.',
      description: 'Start with one pie, end with adding any two fractions.',
    })
    .expect(201);
  const courseId = res.body.course.id as string;
  if (publish) {
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }
  return courseId;
}

async function createModule(courseId: string, token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Equivalent fractions' })
    .expect(201);
  return res.body.module.id as string;
}

/** A page the syllabus shows: written, published, and holding a recording of its own. */
async function lessonWithVideo(moduleId: string, token: string): Promise<string> {
  const lesson = await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Why the denominator stays put', body: 'Start with one pie. Cut it twice.' })
    .expect(201);
  const lessonId = lesson.body.lesson.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', VIDEO, { filename: 'the-pie.mp4', contentType: 'video/mp4' })
    .expect(201);
  return lessonId;
}

async function markFree(moduleId: string, lessonId: string, token: string) {
  await request(app.getHttpServer())
    .patch(`/api/v1/modules/${moduleId}/lessons/${lessonId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ isFreePreview: true })
    .expect(200);
}

async function takePlace(student: string, courseId: string) {
  await request(app.getHttpServer())
    .post('/api/v1/enrollments')
    .set('Authorization', `Bearer ${student}`)
    .send({ courseId })
    .expect(200);
}

function video(address: string, lessonId: string, token?: string, range?: string): request.Test {
  const call = request(app.getHttpServer())
    .get(`/api/v1/catalog/courses/${address}/lessons/${lessonId}/video`)
    // The body of this route is a file, so it has to be read as bytes rather than parsed; and
    // buffering it is what lets the tests compare whole recordings and slices.
    .responseType('arraybuffer')
    .buffer(true);
  if (token) call.set('Authorization', `Bearer ${token}`);
  if (range) call.set('Range', range);
  return call;
}

/** The same route, read as the API's error body rather than as bytes — which is the shape a
 * refusal has, and the only way to see what a gate said rather than what it withheld. */
function refusal(address: string, lessonId: string, token?: string): request.Test {
  const call = request(app.getHttpServer()).get(
    `/api/v1/catalog/courses/${address}/lessons/${lessonId}/video`,
  );
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

/** The page itself, read as the JSON a student's lesson screen gets before it asks for a
 * single byte of a recording. What it needs from that first read is one fact it cannot infer:
 * whether there is anything to play. Guessing it by trying the video route would work on a
 * page with a file and on no other, which is the definition of a bug you ship. */
function page(address: string, lessonId: string, token?: string): request.Test {
  const call = request(app.getHttpServer()).get(
    `/api/v1/catalog/courses/${address}/lessons/${lessonId}`,
  );
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

/** A second take of the same lesson, which retires the first rather than overwriting it. */
async function attach(
  moduleId: string,
  lessonId: string,
  token: string,
  filename: string,
  bytes: Buffer,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/asset`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', bytes, { filename, contentType: 'video/mp4' })
    .expect(201);
}

/** The parts of a failure that must match between "not yours" and "never there". */
function failureShape(body: Record<string, unknown>) {
  return { statusCode: body.statusCode, code: body.code, message: body.message };
}

describe('a lesson recording, streamed', () => {
  let teacher: string;
  let student: string;
  let stranger: string;

  beforeAll(async () => {
    await seedLookups(prisma);
    storageRoot = await mkdtemp(join(tmpdir(), 'lms-stream-'));
    process.env.STORAGE_LOCAL_DIR = storageRoot;
    app = await createTestApp({ imports: [AppModule] });

    await register('tessa.stream', 'teacher');
    await register('sam.stream', 'student');
    await register('rita.stream', 'student');
    teacher = await tokenFor('tessa.stream');
    student = await tokenFor('sam.stream');
    stranger = await tokenFor('rita.stream');
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
    await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('hands a free preview to a stranger with no session, whole', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const res = await video(courseId, lessonId).expect(200);

    expect(res.body).toEqual(VIDEO);
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.headers['content-length']).toBe(String(TOTAL));
    // The one header that tells a player ranges are worth asking for at all. Without it a
    // browser assumes a server cannot honour them and stops sending them.
    expect(res.headers['accept-ranges']).toBe('bytes');
    // And the one that tells nobody to keep it: this is a gated file served to whoever the gate
    // let through, and a shared cache holding it would hand it to the next visitor.
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['cache-control']).toContain('private');
  });

  it('opens a gated page for the student holding a place, and for nobody else', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);

    const anonymous = await refusal(courseId, lessonId).expect(404);
    const outsider = await refusal(courseId, lessonId, stranger).expect(404);
    await takePlace(student, courseId);
    const enrolled = await video(courseId, lessonId, student).expect(200);

    expect(enrolled.body).toEqual(VIDEO);
    // A refusal that streamed would be a gate that only checks the status line. What came back
    // for these two was the API's own body, and not one byte of a recording.
    expect(anonymous.body.code).toBe('NOT_FOUND');
    expect(outsider.body.code).toBe('NOT_FOUND');
    expect(outsider.headers['content-type']).toContain('application/json');
  });

  it('refuses a locked page in the same words as one never written', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    const held = randomUUID();

    const locked = await refusal(courseId, lessonId, stranger).expect(404);
    const absent = await refusal(courseId, held, stranger).expect(404);

    expect(failureShape(locked.body)).toEqual(failureShape(absent.body));
    expect(locked.body.code).toBe('NOT_FOUND');
    expect(JSON.stringify(locked.body)).not.toMatch(/enroll|free|lock|preview/i);
  });

  it('keeps the outer gate shut: a free page of a course nobody published', async () => {
    const courseId = await createCourse(teacher, false);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const res = await refusal(courseId, lessonId).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('answers a page with nothing attached by saying there is no recording', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lesson = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ title: 'No film for this one', body: 'Just the page.' })
      .expect(201);
    const lessonId = lesson.body.lesson.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    await markFree(moduleId, lessonId, teacher);

    const res = await refusal(courseId, lessonId).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('We cannot find that recording.');
  });

  it('works spelled either way the course is addressed', async () => {
    const courseId = await createCourse(teacher);
    const course = await prisma.course.findFirstOrThrow({
      where: { id: courseId },
      select: { slug: true },
    });
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const byId = await video(courseId, lessonId).expect(200);
    const bySlug = await video(course.slug, lessonId).expect(200);

    // Two spellings of the same address, one answer — the property the rest of the catalog keeps
    // and that a gate has to keep too, since a door that opens for one spelling only is a door
    // somebody will find a way round.
    expect(bySlug.body).toEqual(byId.body);
    expect(bySlug.headers['content-range']).toBeUndefined();
  });

  it('serves the piece a seeking player asked for', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const res = await video(courseId, lessonId, undefined, 'bytes=8-15').expect(206);

    expect(res.body).toEqual(VIDEO.subarray(8, 16));
    expect(res.headers['content-range']).toBe(`bytes 8-15/${TOTAL}`);
    expect(res.headers['content-length']).toBe('8');
    // The whole length travels in that header for exactly one reason: the player has to know how
    // far the scrubber goes, and a piece of a file does not tell it.
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('counts an open-ended range from where the player said to start', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const res = await video(courseId, lessonId, undefined, 'bytes=990-').expect(206);

    expect(res.body).toEqual(VIDEO.subarray(990));
    expect(res.headers['content-range']).toBe(`bytes 990-${TOTAL - 1}/${TOTAL}`);
    expect(res.headers['content-length']).toBe('10');
  });

  it('counts a suffix range from the end, which is why it never has to know the length', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    // A player probing for an MP4's trailer asks for the last bytes of a file whose size it has
    // not been told yet. Resolving that against the row's length is the server's job.
    const res = await video(courseId, lessonId, undefined, 'bytes=-8').expect(206);

    expect(res.body).toEqual(VIDEO.subarray(TOTAL - 8));
    expect(res.headers['content-range']).toBe(`bytes ${TOTAL - 8}-${TOTAL - 1}/${TOTAL}`);
  });

  it('clamps a range that runs past the end instead of promising bytes that do not exist', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const res = await video(courseId, lessonId, undefined, 'bytes=990-50000').expect(206);

    expect(res.body).toEqual(VIDEO.subarray(990));
    expect(res.headers['content-range']).toBe(`bytes 990-${TOTAL - 1}/${TOTAL}`);
  });

  it('refuses a range that begins past the end, and answers with the length it should have had', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const res = await video(courseId, lessonId, undefined, `bytes=${TOTAL}-`).expect(416);

    // The one case where the total is the whole message: the player is asking beyond a file it
    // believes is longer, and `*` is what corrects it.
    expect(res.headers['content-range']).toBe(`bytes */${TOTAL}`);
    expect(res.body.length ?? 0).toBe(0);
  });

  it('ignores a range it cannot make sense of and serves the file whole', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const ignored = ['bytes=abc-def', 'bytes=500-100', 'items=0-9', 'bytes=0-3,8-11', 'bytes='];

    for (const header of ignored) {
      const res = await video(courseId, lessonId, undefined, header).expect(200);

      // A range the server cannot honour is not an error to argue about: the client that sent it
      // gets the file and carries on. `multipart/byteranges` is the other answer and no player
      // this platform serves has ever asked for it.
      expect(res.body).toEqual(VIDEO);
      expect(res.headers['content-range']).toBeUndefined();
      expect(res.headers['content-length']).toBe(String(TOTAL));
    }
  });

  it('never lets the store key reach the wire', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const row = await prisma.lessonAsset.findFirstOrThrow({ where: { lessonId, isActive: true } });
    const served = await video(courseId, lessonId).expect(200);
    const refused = await video(courseId, randomUUID()).expect(404);

    // The bytes are the answer; nothing about where they live travels with them. A key in a
    // header would be the start of a URL, and a URL for these bytes is what this design refuses
    // to have — one door, and it is the route with the gate on it.
    for (const res of [served, refused]) {
      expect(JSON.stringify(res.headers)).not.toContain(row.storedKey);
      expect(String(res.body)).not.toContain(row.storedKey);
    }
  });

  it('goes quiet when the player hangs up midway, and is there for the next one', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    // A tab closed halfway through a seek is the ordinary case rather than the error case. The
    // server has to notice the socket went, stop writing into it, and — the part a missing error
    // handler is famous for — survive it, since an unhandled stream error on a read is an
    // uncaught exception in the process that is serving everybody else. The proof of surviving
    // is the next request, which is what the next student in the next minute will do.
    // Nest hands out the same server supertest listens per request, and supertest buffers a
    // response rather than streaming it — so hanging up needs a port of its own.
    const server = app.getHttpServer() as unknown as http.Server;
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    }
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `/api/v1/catalog/courses/${courseId}/lessons/${lessonId}/video`,
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          res.on('data', () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on('error', () => resolve());
    });

    const next = await video(courseId, lessonId).expect(200);
    expect(next.body).toEqual(VIDEO);
  });

  it('names the recording on the page, so a player knows to exist', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const res = await page(courseId, lessonId).expect(200);

    // Two facts a student's page can put in words — what the file is called and how big it is —
    // and nothing else. `toEqual` is the assertion here precisely because it refuses extra keys:
    // a length on the wire is fine, a route's private fields on it are not.
    expect(res.body.lesson.video).toEqual({ displayName: 'the-pie.mp4', bytes: TOTAL });
  });

  it('says the same thing to a student holding a place as to a page left open', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await takePlace(student, courseId);

    const res = await page(courseId, lessonId, student).expect(200);

    // The paid case, which is the case the recording exists for. A field that only appeared on a
    // free preview would tell the enrolled student's page there was nothing to play on the
    // lesson they enrolled to watch.
    expect(res.body.lesson.video).toEqual({ displayName: 'the-pie.mp4', bytes: TOTAL });
  });

  it('says there is nothing to play on a page nobody recorded', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lesson = await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ title: 'Just the words', body: 'No film for this one.' })
      .expect(201);
    const lessonId = lesson.body.lesson.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/modules/${moduleId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);
    await markFree(moduleId, lessonId, teacher);

    const res = await page(courseId, lessonId).expect(200);

    // `null` rather than a missing key: a page that cannot tell the two apart will draw a
    // disabled player, and the whole point of the field is that absence is the common case.
    expect(res.body.lesson.video).toBeNull();
  });

  it('names the take that stands, not the one it retired', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const retake = patterned(TOTAL + 400);
    await attach(moduleId, lessonId, teacher, 'the-pie-take-two.mp4', retake);

    const res = await page(courseId, lessonId).expect(200);
    expect(res.body.lesson.video).toEqual({
      displayName: 'the-pie-take-two.mp4',
      bytes: TOTAL + 400,
    });

    const rows = await prisma.lessonAsset.findMany({
      where: { lessonId },
      select: { displayName: true, isActive: true },
    });
    // The page shows one recording because the lesson *has* one standing, not because the older
    // row was thrown away — the retired take keeps its bytes and its place in the file's history.
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isActive).map((row) => row.displayName)).toEqual([
      'the-pie-take-two.mp4',
    ]);
  });

  it('keeps the store key out of the page that names the recording', async () => {
    const courseId = await createCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await lessonWithVideo(moduleId, teacher);
    await markFree(moduleId, lessonId, teacher);

    const row = await prisma.lessonAsset.findFirstOrThrow({ where: { lessonId, isActive: true } });
    const res = await page(courseId, lessonId).expect(200);

    // Metadata is not a location. The key is the only thing that could be turned into a path,
    // and the path a browser needs is already in the page's own route.
    expect(JSON.stringify(res.body)).not.toContain(row.storedKey);
  });
});
