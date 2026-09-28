import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * Enrollment: a student taking a place in a course, and what that place is worth.
 *
 * Three rules carry the suite, and they are the three the table was built to make possible.
 *
 * A place is taken once. Pressing the button twice is one event, not two, so the second call
 * answers with the row that already exists rather than a conflict or a duplicate — the roster
 * has one entry per student either way, and `enrolledAt` still names the day they first came.
 *
 * A place is worth the pages behind it. The catalog's two published gates stay exactly as they
 * were — a student who enrolls does not get to read a page its teacher pulled back — and the
 * enrollment is the third question that unlocks everything else. Leaving closes it again.
 *
 * And a place is a relationship, not a public record. Only its own student's session can see
 * it or end it, and a route that cannot tell whose place it is refuses the way the catalog
 * refuses a draft: with the same answer an invented id gets.
 *
 * Nobody gets to enroll in a course that is not on the shelf. `NOT_FOUND` for a draft, an
 * archive, a typo and a uuid that was never written are one message on purpose — an enroll
 * endpoint that distinguished them would be a way to walk the teacher's unpublished work.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';
const MARK = RUN;

const COMPLETE = {
  summary: 'A first pass at the topic.',
  description: 'Start with one pie, end with adding any two fractions.',
};

let app: INestApplication;
const prisma = new PrismaClient();

async function tokenFor(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

async function userIdFor(name: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email: emailFor(name) } });
  return user.id;
}

function enroll(token: string | undefined, courseId: string): request.Test {
  const call = request(app.getHttpServer()).post('/api/v1/enrollments');
  return (token ? call.set('Authorization', `Bearer ${token}`) : call).send({ courseId });
}

function myEnrollments(token?: string): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/enrollments');
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

function cancelEnrollment(token: string | undefined, id: string): request.Test {
  const call = request(app.getHttpServer()).post(`/api/v1/enrollments/${id}/cancel`);
  return (token ? call.set('Authorization', `Bearer ${token}`) : call).send();
}

function readLesson(courseId: string, lessonId: string, token?: string): request.Test {
  const call = request(app.getHttpServer()).get(
    `/api/v1/catalog/courses/${courseId}/lessons/${lessonId}`,
  );
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

let courseSequence = 0;

async function createCourse(token: string): Promise<string> {
  courseSequence += 1;
  const res = await request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Fractions slowly ${MARK} ${courseSequence}`,
      slug: `fractions-slowly-${courseSequence}-${RUN}`,
      level: 'beginner',
      ...COMPLETE,
    })
    .expect(201);
  return res.body.course.id as string;
}

async function createPublishedCourse(token: string): Promise<string> {
  const id = await createCourse(token);
  await request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return id;
}

async function createModule(courseId: string, token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/courses/${courseId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Equivalent fractions' })
    .expect(201);
  return res.body.module.id as string;
}

/** A page a student may read once they are inside: published, and not marked free. */
async function createLockedLesson(
  moduleId: string,
  token: string,
  body = 'Cut the pie twice. Nothing about the pie changed.',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Why the denominator stays put', body, estimatedMinutes: 8 })
    .expect(201);
  const id = res.body.lesson.id as string;
  await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons/${id}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return id;
}

/** The one page that opens for anybody, enrolled or not. */
async function createFreeLesson(moduleId: string, token: string): Promise<string> {
  const id = await createLockedLesson(moduleId, token, 'This one is on the house.');
  await request(app.getHttpServer())
    .patch(`/api/v1/modules/${moduleId}/lessons/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ isFreePreview: true })
    .expect(200);
  return id;
}

/** A page the teacher wrote and then pulled back, inside a course that is live. */
async function createDraftLesson(moduleId: string, token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/api/v1/modules/${moduleId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Still being written', body: 'Half an explanation.' })
    .expect(201);
  return res.body.lesson.id as string;
}

/** The parts of a failure that must match. `requestId` is deliberately not one of them: it
 * is per request, and comparing it would make every "these two are the same answer" check
 * below pass for the wrong reason or fail for the right one. */
function failureShape(body: Record<string, unknown>) {
  return { statusCode: body.statusCode, code: body.code, message: body.message };
}

/** One row of the catalog outline as these tests read it. Every field is named rather than
 * a `toMatchObject` pattern, so an outline that started shipping a body would fail here for
 * the right reason instead of matching a shape two tests agree on loosely. */
interface OutlineRow {
  id: string;
  title: string;
  position: number;
  estimatedMinutes: number | null;
  isFreePreview: boolean;
  isReadable: boolean;
}

describe('enrollments', () => {
  let teacher: string;
  let otherTeacher: string;
  let sam: string;
  let second: string;

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    for (const [name, role] of [
      ['tessa', 'teacher'],
      ['rita', 'teacher'],
      ['sam', 'student'],
      ['nadia', 'student'],
    ] as const) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: emailFor(name), password: PASSWORD, fullName: 'Enrollment Test', role });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    }
    teacher = await tokenFor('tessa');
    otherTeacher = await tokenFor('rita');
    sam = await tokenFor('sam');
    second = await tokenFor('nadia');
  });

  afterAll(async () => {
    await app?.close();
    // Children before parents: the schema restricts every relation, so the order is the
    // only thing that lets the rows leave.
    const userIds = (
      await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
    ).map((row) => row.id);
    const courseIds = (
      await prisma.course.findMany({ where: { teacherUserId: { in: userIds } }, select: { id: true } })
    ).map((row) => row.id);
    const moduleIds = (
      await prisma.module.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } })
    ).map((row) => row.id);
    await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
    await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.lesson.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('will not take a place from somebody it cannot see', async () => {
    const courseId = await createPublishedCourse(teacher);

    const res = await enroll(undefined, courseId).expect(401);

    // A catalog page is readable by a stranger; a place in a course is not a thing a
    // stranger can ask for. The route is behind the guard every write in this API runs
    // against, and the suite checks that rather than assuming it.
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(0);
  });

  it('keeps a teacher out of the room', async () => {
    const courseId = await createPublishedCourse(teacher);

    const res = await enroll(teacher, courseId).expect(403);

    // Enrolling is a student's act, so the role answers it at the door instead of a rule
    // inside the service that would have to remember which side of the pair it checks.
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(0);
  });

  it('takes a place in a published course', async () => {
    const courseId = await createPublishedCourse(teacher);

    const res = await enroll(sam, courseId).expect(200);

    expect(res.body.enrollment).toMatchObject({
      isActive: true,
      course: { id: courseId },
      enrolledAt: expect.any(String),
    });
    expect(new Date(res.body.enrollment.enrolledAt).getTime()).not.toBeNaN();
  });

  it('answers a second press with the one place it already is', async () => {
    const courseId = await createPublishedCourse(teacher);

    const first = await enroll(sam, courseId).expect(200);
    const again = await enroll(sam, courseId).expect(200);

    // Two codes for one button would make the portal branch on whether it had been clicked
    // before. The answer is the same place either way, and the table only ever held one.
    expect(again.body.enrollment.id).toBe(first.body.enrollment.id);
    expect(again.body.enrollment.enrolledAt).toBe(first.body.enrollment.enrolledAt);
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(1);
  });

  it('refuses a request that does not name a course', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/enrollments')
      .set('Authorization', `Bearer ${sam}`)
      .send({})
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    // At least one message for the field, and possibly more than one: the pipe collects every
    // rule that a missing key fails, so the contract is "the form can highlight courseId".
    expect(res.body.details.validation).toMatchObject({
      courseId: expect.arrayContaining([expect.any(String)]),
    });
  });

  it('will not take a place in a course nobody published', async () => {
    const courseId = await createCourse(teacher);

    const draft = await enroll(sam, courseId).expect(404);
    const invented = await enroll(sam, randomUUID()).expect(404);
    const malformed = await enroll(sam, 'not-a-course-id').expect(404);

    // A draft, a course that never existed and a uuid that cannot exist are one answer, the
    // same silence the catalog gives them. An endpoint that said "that one is a draft"
    // would be a list of what is coming.
    expect(failureShape(malformed.body)).toEqual(failureShape(invented.body));
    expect(failureShape(invented.body)).toEqual(failureShape(draft.body));
    expect(draft.body.code).toBe('NOT_FOUND');
    // Scoped to this course, because the student holds places in others from earlier tests:
    // the refusal has to write nothing anywhere, and the only row any of these three calls
    // could have written is one against this id.
    const student = await userIdFor('sam');
    expect(await prisma.enrollment.count({ where: { studentUserId: student, courseId } })).toBe(0);
  });

  it('opens the pages a course holds to the students inside it', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await createLockedLesson(moduleId, teacher);

    const before = await readLesson(courseId, lessonId, sam).expect(404);
    const missing = await readLesson(courseId, randomUUID(), sam).expect(404);

    // Locked and absent answer the same way with a session in the hand, exactly as they do
    // without one: enrollment is not a hint about what exists.
    expect(failureShape(missing.body)).toEqual(failureShape(before.body));

    await enroll(sam, courseId).expect(200);

    const res = await readLesson(courseId, lessonId, sam).expect(200);
    expect(res.body.lesson).toMatchObject({
      id: lessonId,
      body: 'Cut the pie twice. Nothing about the pie changed.',
      // The teacher never marked this one free; it opened because of who asked.
      isFreePreview: false,
      course: { id: courseId },
    });
  });

  it('still keeps a page its teacher pulled back, enrolled or not', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const draftLesson = await createDraftLesson(moduleId, teacher);

    await enroll(sam, courseId).expect(200);

    // The inner gate was never about strangers. A teacher unpublishing a page means it is
    // not readable, and an enrollment bought no exemption from that.
    const res = await readLesson(courseId, draftLesson, sam).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('leaves the free door open for whoever walks up', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const freeLesson = await createFreeLesson(moduleId, teacher);

    // A stranger reads it with no session at all...
    await readLesson(courseId, freeLesson).expect(200);
    // ...and an enrolled student reads the same page for the same reason. Enrollment adds
    // pages to what a caller may open; it never subtracts the ones already open.
    await enroll(sam, courseId).expect(200);
    const res = await readLesson(courseId, freeLesson, sam).expect(200);
    expect(res.body.lesson.isFreePreview).toBe(true);
  });

  it('will not let one student read another’s course', async () => {
    const courseId = await createPublishedCourse(otherTeacher);
    const moduleId = await createModule(courseId, otherTeacher);
    const lessonId = await createLockedLesson(moduleId, otherTeacher);

    await enroll(second, courseId).expect(200);

    // The place is a relationship between one student and one course, so another session —
    // even a real, active student — gets the locked answer, not a permission error.
    const res = await readLesson(courseId, lessonId, sam).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('lists the courses a student is inside, newest first, and nobody else’s', async () => {
    const older = await createPublishedCourse(teacher);
    const newer = await createPublishedCourse(otherTeacher);

    await enroll(sam, older).expect(200);
    await enroll(sam, newer).expect(200);
    await enroll(second, older).expect(200);

    const res = await myEnrollments(sam).expect(200);
    const ids = res.body.items.map((item: { course: { id: string } }) => item.course.id);

    // This student collects places across the whole suite, so the assertion is about the two
    // this test just opened rather than about the length of the list: what is being checked is
    // the ordering rule and that an enrollment a caller holds always shows.
    const mine = ids.filter((id: string) => id === older || id === newer);
    expect(mine).toEqual([newer, older]);

    // A student's list is their own; a second caller sees their own and no other names.
    const other = await myEnrollments(second).expect(200);
    const theirs = other.body.items.map((item: { course: { id: string } }) => item.course.id);
    expect(theirs).toContain(older);
    expect(theirs).not.toContain(newer);
  });

  it('closes the whole course when its teacher retires it', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await createLockedLesson(moduleId, teacher);

    await enroll(sam, courseId).expect(200);
    await readLesson(courseId, lessonId, sam).expect(200);

    // Archiving stops delivery, to the people inside as much as to the ones outside. A
    // place that kept reading a retired course would be a promise the teacher has just
    // withdrawn, and the only honest answer for its pages is the one a locked page gives.
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);

    await readLesson(courseId, lessonId, sam).expect(404);

    // And the retired course leaves the student's own list, so the portal cannot render a
    // link to a page that will not open. The enrollment row itself is untouched.
    const listed = await myEnrollments(sam).expect(200);
    expect(
      listed.body.items.filter((item: { course: { id: string } }) => item.course.id === courseId),
    ).toHaveLength(0);
    const student = await userIdFor('sam');
    expect(
      await prisma.enrollment.count({
        where: { studentUserId: student, courseId, isActive: true },
      }),
    ).toBe(1);
  });

  it('closes the pages when a student leaves', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await createLockedLesson(moduleId, teacher);
    const freeLesson = await createFreeLesson(moduleId, teacher);

    const placed = await enroll(sam, courseId).expect(200);
    await readLesson(courseId, lessonId, sam).expect(200);

    const cancelled = await cancelEnrollment(sam, placed.body.enrollment.id).expect(200);
    expect(cancelled.body.enrollment).toMatchObject({ id: placed.body.enrollment.id, isActive: false });

    // The row stayed: what the student read happened, and a roster that forgets it is a
    // record with a hole in it.
    expect(await prisma.enrollment.count({ where: { id: placed.body.enrollment.id } })).toBe(1);

    await readLesson(courseId, lessonId, sam).expect(404);
    // The teacher's own open door never depended on the place.
    await readLesson(courseId, freeLesson, sam).expect(200);

    const listed = await myEnrollments(sam).expect(200);
    expect(
      listed.body.items.filter((item: { course: { id: string } }) => item.course.id === courseId),
    ).toHaveLength(0);
  });

  it('comes back to the same place rather than a new one', async () => {
    const courseId = await createPublishedCourse(teacher);
    const moduleId = await createModule(courseId, teacher);
    const lessonId = await createLockedLesson(moduleId, teacher);

    const first = await enroll(sam, courseId).expect(200);
    await cancelEnrollment(sam, first.body.enrollment.id).expect(200);
    await readLesson(courseId, lessonId, sam).expect(404);

    const back = await enroll(sam, courseId).expect(200);
    expect(back.body.enrollment).toMatchObject({
      id: first.body.enrollment.id,
      isActive: true,
      enrolledAt: first.body.enrollment.enrolledAt,
    });

    // Open again from the row that was already there — one place, and the day it was first
    // taken is still the day the student started.
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(1);
    await readLesson(courseId, lessonId, sam).expect(200);
  });

  it('will not cancel a place that is not the caller’s', async () => {
    const courseId = await createPublishedCourse(teacher);
    const placed = await enroll(sam, courseId).expect(200);
    const id = placed.body.enrollment.id as string;

    const other = await cancelEnrollment(second, id).expect(404);
    const invented = await cancelEnrollment(second, randomUUID()).expect(404);

    // Someone else's enrollment id is not a fact about you, so it earns the same answer as
    // an id never written — and the place stays open.
    expect(failureShape(invented.body)).toEqual(failureShape(other.body));
    expect(await prisma.enrollment.findUniqueOrThrow({ where: { id } })).toMatchObject({
      isActive: true,
    });
  });

  it('treats leaving twice as already having left', async () => {
    const courseId = await createPublishedCourse(teacher);
    const placed = await enroll(sam, courseId).expect(200);
    const id = placed.body.enrollment.id as string;

    await cancelEnrollment(sam, id).expect(200);
    const again = await cancelEnrollment(sam, id).expect(200);

    // A double-click on "leave" is not an error the portal has to explain, and the row it
    // answers with is the same closed row rather than a second one.
    expect(again.body.enrollment).toMatchObject({ id, isActive: false });
    expect(await prisma.enrollment.count({ where: { courseId } })).toBe(1);
  });

  it('does not answer a request from nobody', async () => {
    await createPublishedCourse(teacher);

    const list = await myEnrollments().expect(401);
    const cancel = await cancelEnrollment(undefined, randomUUID()).expect(401);

    expect(list.body.code).toBe('UNAUTHORIZED');
    expect(cancel.body.code).toBe('UNAUTHORIZED');
  });

  describe('what the outline says about the caller', () => {
    /**
     * The course page is the map, and a map has to say which doors are open. These check that
     * the answer is the same fact the page route already applies — free door, or a place in the
     * course — rather than a second rule the outline invented for itself.
     */
    function readCourse(address: string, token?: string): request.Test {
      const call = request(app.getHttpServer()).get(`/api/v1/catalog/courses/${address}`);
      return token ? call.set('Authorization', `Bearer ${token}`) : call;
    }

    /** Every row on the syllabus, flattened, since a page's place in a block is not what is
     * being asked here — its openness is. */
    function outlineRows(res: request.Response): OutlineRow[] {
      return (res.body.course.modules as { lessons: OutlineRow[] }[]).flatMap(
        (module) => module.lessons,
      );
    }

    /** A course with one of each kind of page: open to all, open to the students inside, and
     * one nobody may read yet. */
    async function courseWithEveryRow(): Promise<{
      courseId: string;
      locked: string;
      free: string;
      draft: string;
    }> {
      const courseId = await createPublishedCourse(teacher);
      const moduleId = await createModule(courseId, teacher);
      return {
        courseId,
        locked: await createLockedLesson(moduleId, teacher),
        free: await createFreeLesson(moduleId, teacher),
        draft: await createDraftLesson(moduleId, teacher),
      };
    }

    it('opens every published page of the outline to a student inside', async () => {
      const { courseId, locked, free, draft } = await courseWithEveryRow();

      const stranger = await readCourse(courseId).expect(200);
      expect(
        outlineRows(stranger).find((row) => row.id === locked)?.isReadable,
      ).toBe(false);
      expect(outlineRows(stranger).find((row) => row.id === free)?.isReadable).toBe(true);

      await enroll(sam, courseId).expect(200);

      const mine = await readCourse(courseId, sam).expect(200);
      expect(outlineRows(mine)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: locked, isReadable: true }),
          expect.objectContaining({ id: free, isReadable: true }),
        ]),
      );
      // The draft is not "locked" on this page — it is not there at all, enrolled or not. A
      // place opens published pages, which is the same promise the page route keeps.
      expect(outlineRows(mine).some((row) => row.id === draft)).toBe(false);
    });

    it('still names the rows rather than sending their text', async () => {
      const { courseId, locked } = await courseWithEveryRow();
      await enroll(sam, courseId).expect(200);

      const res = await readCourse(courseId, sam).expect(200);
      const row = outlineRows(res).find((each) => each.id === locked)!;

      // A place is worth the pages, not the whole course in one response: `body` belongs to
      // the page route, which is where the gate lives.
      expect(row).not.toHaveProperty('body');
      expect(Object.keys(row).sort()).toEqual(
        ['estimatedMinutes', 'id', 'isFreePreview', 'isReadable', 'position', 'title'].sort(),
      );
    });

    it('says the same thing about a slug and an id, whoever is asking', async () => {
      const { courseId, locked } = await courseWithEveryRow();
      const { slug } = await prisma.course.findUniqueOrThrow({
        where: { id: courseId },
        select: { slug: true },
      });

      await enroll(sam, courseId).expect(200);

      const byId = await readCourse(courseId, sam).expect(200);
      const bySlug = await readCourse(slug, sam).expect(200);

      // The two addresses already had to agree for a stranger; a session must not be able to
      // make them disagree, or one of them is a different course's rules.
      expect(outlineRows(bySlug)).toEqual(outlineRows(byId));
      expect(outlineRows(byId).find((row) => row.id === locked)?.isReadable).toBe(true);
    });

    it('closes the outline again when the student leaves', async () => {
      const { courseId, locked, free } = await courseWithEveryRow();
      const placed = await enroll(sam, courseId).expect(200);

      await cancelEnrollment(sam, placed.body.enrollment.id).expect(200);

      const after = await readCourse(courseId, sam).expect(200);
      expect(outlineRows(after).find((row) => row.id === locked)?.isReadable).toBe(false);
      // The teacher's own door never depended on the place, so leaving does not shut it.
      expect(outlineRows(after).find((row) => row.id === free)?.isReadable).toBe(true);
    });

    it('will not open another student’s outline for a stranger with a session', async () => {
      const { courseId, locked } = await courseWithEveryRow();
      await enroll(second, courseId).expect(200);

      const withSession = await readCourse(courseId, sam).expect(200);
      const anonymous = await readCourse(courseId).expect(200);

      // Handing over a real session that does not hold a place changes nothing: a place is a
      // relationship, not a hint that opens doors.
      expect(outlineRows(withSession).find((row) => row.id === locked)?.isReadable).toBe(false);
      expect(outlineRows(withSession)).toEqual(outlineRows(anonymous));
    });

    it('refuses a broken session on the outline the way the page route does', async () => {
      const { courseId } = await courseWithEveryRow();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/catalog/courses/${courseId}`)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);

      // An optional session is optional about an absent one only. Answering this as a stranger
      // would let an expired token read an enrolled student's syllabus forever without the
      // portal ever being told to sign in again.
      expect(res.body.code).toBe('TOKEN_INVALID');
      await readCourse(courseId).expect(200);
    });
  });
});
