import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * The course as a teacher's own document, before any student can see it.
 *
 * Two rules carry most of the weight here. Ownership is answered by the API, not by which
 * screen the portal shows — and it answers `NOT_FOUND` rather than `FORBIDDEN` for a course
 * belonging to someone else, because "you may not edit that" tells a competitor the course
 * exists. The second is that publishing is a transition, never a field: a client that can
 * write `status: 'published'` into a body has a publish button no completeness check saw.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

/** What a course needs before a student is allowed to read it. */
const COMPLETE = {
  title: 'Algebra for the CBSE boards',
  summary: 'Ten years of board papers, worked from the marking scheme backwards.',
  description:
    'Every chapter starts with the questions that actually appeared, then builds the maths ' +
    'needed to answer them without memorising the paper.',
  level: 'intermediate',
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

function postCourse(body: object, token: string): request.Test {
  return request(app.getHttpServer())
    .post('/api/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function listCourses(token: string, query = ''): request.Test {
  return request(app.getHttpServer())
    .get(`/api/v1/courses${query}`)
    .set('Authorization', `Bearer ${token}`);
}

function getCourse(id: string, token: string): request.Test {
  return request(app.getHttpServer())
    .get(`/api/v1/courses/${id}`)
    .set('Authorization', `Bearer ${token}`);
}

function patchCourse(id: string, body: object, token: string): request.Test {
  return request(app.getHttpServer())
    .patch(`/api/v1/courses/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function transition(id: string, verb: 'publish' | 'archive', token: string): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/courses/${id}/${verb}`)
    .set('Authorization', `Bearer ${token}`);
}

/** A draft with only what a teacher writes first: no summary of the topic for a student,
 * no description. Each call takes its own slug, because a teacher owns one address each. */
let draftSequence = 0;

async function createDraft(token: string): Promise<string> {
  draftSequence += 1;
  const res = await postCourse(
    {
      title: 'Fractions, slowly',
      slug: `fractions-slowly-${draftSequence}`,
      level: 'beginner',
    },
    token,
  ).expect(201);
  return res.body.course.id as string;
}

describe('courses', () => {
  let teacher: string;
  let otherTeacher: string;
  let student: string;
  let ritasCourseId: string;

  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    for (const [name, role] of [
      ['tessa', 'teacher'],
      ['rita', 'teacher'],
      ['sam', 'student'],
    ] as const) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: emailFor(name), password: PASSWORD, fullName: 'Course Test', role });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    }
    teacher = await tokenFor('tessa');
    otherTeacher = await tokenFor('rita');
    student = await tokenFor('sam');
  });

  afterAll(async () => {
    await app?.close();
    // Children before parents: the schema restricts both relations, so the order is the
    // only way a suite gets to clear its own rows.
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.course.deleteMany({ where: { teacherUserId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('refuses to answer without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/courses').expect(401);

    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('refuses a student the teacher routes', async () => {
    const res = await listCourses(student).expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('offers the levels a teacher can choose, in the catalogue order', async () => {
    // The portal renders this list rather than keeping its own three strings, so a level
    // Ops adds is a row that appears — not a release nobody remembered to plan.
    const res = await request(app.getHttpServer())
      .get('/api/v1/courses/levels')
      .set('Authorization', `Bearer ${teacher}`)
      .expect(200);

    expect(res.body.items).toEqual([
      { code: 'beginner', label: 'Beginner' },
      { code: 'intermediate', label: 'Intermediate' },
      { code: 'advanced', label: 'Advanced' },
    ]);
  });

  it('does not hand the level catalogue to a student', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/courses/levels')
      .set('Authorization', `Bearer ${student}`)
      .expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('starts a course as a draft, not as something a student can find', async () => {
    const res = await postCourse(
      { title: 'Algebra for the CBSE boards', level: 'intermediate' },
      teacher,
    ).expect(201);

    expect(res.body.course).toMatchObject({
      slug: 'algebra-for-the-cbse-boards',
      status: { code: 'draft' },
      level: { code: 'intermediate', label: 'Intermediate' },
      summary: null,
      description: null,
    });
  });

  it('keeps a slug the teacher typed instead of overwriting their work', async () => {
    const res = await postCourse({ ...COMPLETE, slug: 'board-algebra-2026' }, teacher).expect(201);

    expect(res.body.course.slug).toBe('board-algebra-2026');
  });

  it('refuses a slug that cannot be a URL segment', async () => {
    const res = await postCourse({ ...COMPLETE, slug: 'Algebra / Boards!' }, teacher).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.slug).toBeDefined();
  });

  it('reports an unknown level against the field, in the words the form shows', async () => {
    const res = await postCourse({ ...COMPLETE, level: 'wizardry' }, teacher).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.level).toBeDefined();
  });

  it('requires a title long enough to read in a list', async () => {
    const res = await postCourse({ title: 'a', level: 'beginner' }, teacher).expect(400);

    expect(res.body.details.validation.title).toBeDefined();
  });

  it('refuses a second course with a slug its own teacher already used', async () => {
    await postCourse({ ...COMPLETE, slug: 'taken-slug' }, teacher).expect(201);
    const res = await postCourse({ ...COMPLETE, slug: 'taken-slug' }, teacher).expect(409);

    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.details.validation.slug).toBeDefined();
  });

  it('lets a different teacher use the same slug, because the address is theirs', async () => {
    await postCourse({ ...COMPLETE, slug: 'common-slug' }, teacher).expect(201);
    const res = await postCourse({ ...COMPLETE, slug: 'common-slug' }, otherTeacher).expect(201);

    ritasCourseId = res.body.course.id as string;
    expect(ritasCourseId).toBeTruthy();
  });

  it('lists a teacher their own courses, newest first, and nobody else’s', async () => {
    const draftId = await createDraft(teacher);
    const res = await listCourses(teacher).expect(200);
    const ids = res.body.items.map((item: { id: string }) => item.id);

    expect(ids).toContain(draftId);
    expect(ids).not.toContain(ritasCourseId);
    // Reverse creation order: the list is what a teacher scans for the thing they were writing.
    expect(ids[0]).toBe(draftId);
    // The list row is the same document, so the portal needs no second request per course.
    expect(res.body.items[0]).toMatchObject({
      title: 'Fractions, slowly',
      status: { code: 'draft' },
    });
  });

  it('filters a teacher’s own list by status', async () => {
    const draftId = await createDraft(teacher);
    await patchCourse(draftId, COMPLETE, teacher).expect(200);
    await transition(draftId, 'publish', teacher).expect(200);

    const published = await listCourses(teacher, '?status=published').expect(200);
    expect(published.body.items.map((item: { id: string }) => item.id)).toEqual([draftId]);

    const nonsense = await listCourses(teacher, '?status=quidditch').expect(400);
    expect(nonsense.body.details.validation.status).toBeDefined();
  });

  it('reads a course back as the same document', async () => {
    const id = await createDraft(teacher);
    const res = await getCourse(id, teacher).expect(200);

    expect(res.body.course).toMatchObject({
      id,
      title: 'Fractions, slowly',
      level: { code: 'beginner' },
      status: { code: 'draft' },
    });
  });

  it('answers another teacher with not-found, not with a denial that names the course', async () => {
    const id = await createDraft(teacher);

    // 403 would confirm the id exists and is a course; the owner is the only person the
    // endpoint will ever talk about it with.
    await getCourse(id, otherTeacher).expect(404);
    await patchCourse(id, { title: 'Stolen title' }, otherTeacher).expect(404);
    await transition(id, 'publish', otherTeacher).expect(404);

    const untouched = await getCourse(id, teacher).expect(200);
    expect(untouched.body.course.title).toBe('Fractions, slowly');
  });

  it('answers a stranger’s id and a malformed id identically', async () => {
    const id = await createDraft(teacher);

    await getCourse(id.replace(/.$/, '0'), teacher).expect(404);
    await getCourse('not-a-uuid', teacher).expect(404);
  });

  it('edits a draft as much as the teacher likes', async () => {
    const id = await createDraft(teacher);
    const res = await patchCourse(
      id,
      { title: 'Fractions, properly', summary: '' },
      teacher,
    ).expect(200);

    expect(res.body.course).toMatchObject({
      title: 'Fractions, properly',
      summary: null,
      // The address does not follow the title: renaming a course must not break the link
      // a teacher already sent around.
      slug: expect.stringMatching(/^fractions-slowly-\d+$/),
    });
  });

  it('will not let a body publish a course by writing its own status', async () => {
    const id = await createDraft(teacher);
    const res = await patchCourse(id, { status: 'published' }, teacher).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    const untouched = await getCourse(id, teacher).expect(200);
    expect(untouched.body.course.status.code).toBe('draft');
  });

  it('refuses to publish what a student could not judge', async () => {
    const id = await createDraft(teacher);
    const res = await transition(id, 'publish', teacher).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    // Named per field so the form can point at the two boxes still empty.
    expect(res.body.details.validation.description).toBeDefined();
    expect(res.body.details.validation.summary).toBeDefined();
  });

  it('publishes once every field a student reads is filled', async () => {
    const id = await createDraft(teacher);
    await patchCourse(id, COMPLETE, teacher).expect(200);
    const res = await transition(id, 'publish', teacher).expect(200);

    expect(res.body.course.status).toMatchObject({ code: 'published', label: 'Published' });
  });

  it('says so when a published course is published again', async () => {
    const id = await createDraft(teacher);
    await patchCourse(id, COMPLETE, teacher).expect(200);
    await transition(id, 'publish', teacher).expect(200);
    const res = await transition(id, 'publish', teacher).expect(409);

    expect(res.body.code).toBe('CONFLICT');
  });

  it('holds a published course still until it is archived', async () => {
    const id = await createDraft(teacher);
    await patchCourse(id, COMPLETE, teacher).expect(200);
    await transition(id, 'publish', teacher).expect(200);

    // Editing what a student is reading, silently, is how a course stops describing the
    // classes people enrolled for. The transition exists for exactly this case.
    const res = await patchCourse(id, { title: 'Renamed mid-flight' }, teacher).expect(409);
    expect(res.body.code).toBe('CONFLICT');

    const unchanged = await getCourse(id, teacher).expect(200);
    expect(unchanged.body.course.title).toBe(COMPLETE.title);
  });

  it('archives a published course and lets it be edited again', async () => {
    const id = await createDraft(teacher);
    await patchCourse(id, COMPLETE, teacher).expect(200);
    await transition(id, 'publish', teacher).expect(200);
    await transition(id, 'archive', teacher).expect(200);

    const archived = await listCourses(teacher, '?status=archived').expect(200);
    expect(archived.body.items.map((item: { id: string }) => item.id)).toContain(id);

    await patchCourse(id, { title: 'Fractions, second run' }, teacher).expect(200);
  });

  it('keeps an archived course out of the published list but not out of the database', async () => {
    const id = await createDraft(teacher);
    await patchCourse(id, COMPLETE, teacher).expect(200);
    await transition(id, 'publish', teacher).expect(200);
    await transition(id, 'archive', teacher).expect(200);

    const published = await listCourses(teacher, '?status=published').expect(200);
    expect(published.body.items.map((item: { id: string }) => item.id)).not.toContain(id);

    // No hard delete: the row is what a later enrollment would have pointed at.
    expect(await prisma.course.count({ where: { id, isActive: true } })).toBe(1);
  });

  describe('what a course costs', () => {
    /**
     * A quote, not a charge. Nothing in this API takes money, so the two columns below hold
     * what a teacher says the course will cost — which is why an amount and a currency are
     * one decision (a number without a unit is not a price) and why leaving them both empty
     * is a state the shelf has to print rather than a default.
     */
    const RUPEE = { minorUnits: 499900, currency: 'INR' };

    it('prices a course in minor units and a currency the catalogue knows', async () => {
      const res = await postCourse(
        { ...COMPLETE, slug: 'priced-algebra', price: RUPEE },
        teacher,
      ).expect(201);

      // The label rides along with the code for the same reason the level's does: the portal
      // that prints it must not be the one keeping the translation table.
      expect(res.body.course.price).toEqual({
        minorUnits: 499900,
        currency: { code: 'INR', label: 'Indian rupee' },
      });
    });

    it('starts a course unpriced, which is not the same as free', async () => {
      const id = await createDraft(teacher);
      const res = await getCourse(id, teacher).expect(200);

      expect(res.body.course.price).toBeNull();
      const columns = await prisma.course.findUniqueOrThrow({
        where: { id },
        select: { priceMinorUnits: true, priceCurrencyValueId: true },
      });
      expect(columns).toEqual({ priceMinorUnits: null, priceCurrencyValueId: null });
    });

    it('publishes a course with no price, because a place is not yet a purchase', async () => {
      const id = await createDraft(teacher);
      await patchCourse(id, COMPLETE, teacher).expect(200);
      const res = await transition(id, 'publish', teacher).expect(200);

      // Enrollment gives a student a page, not a receipt, so a price cannot be a precondition
      // of publication — and a teacher quoting one later is a draft edit away.
      expect(res.body.course.price).toBeNull();
    });

    it('refuses half a price, because an amount with no unit is not a price', async () => {
      const res = await postCourse({ ...COMPLETE, price: { minorUnits: 499900 } }, teacher).expect(
        400,
      );

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.validation.currency).toBeDefined();

      const amountMissing = await postCourse(
        { ...COMPLETE, price: { currency: 'INR' } },
        teacher,
      ).expect(400);
      expect(amountMissing.body.details.validation.minorUnits).toBeDefined();
    });

    it('refuses an amount that is negative or not whole minor units', async () => {
      const negative = await postCourse(
        { ...COMPLETE, price: { minorUnits: -100, currency: 'INR' } },
        teacher,
      ).expect(400);
      expect(negative.body.details.validation.minorUnits).toBeDefined();

      // ₹4999.005 is a figure no column could hold and no student could be asked to pay.
      const fractional = await postCourse(
        { ...COMPLETE, price: { minorUnits: 499900.5, currency: 'INR' } },
        teacher,
      ).expect(400);
      expect(fractional.body.details.validation.minorUnits).toBeDefined();
    });

    it('refuses a currency the catalogue does not offer, including one it offers for something else', async () => {
      const invented = await postCourse(
        { ...COMPLETE, price: { minorUnits: 100, currency: 'xyz' } },
        teacher,
      ).expect(400);
      expect(invented.body.code).toBe('VALIDATION_FAILED');
      expect(invented.body.details.validation.price).toBeDefined();

      // `beginner` is a real row in a real lookup — the wrong one. The check is scoped to the
      // Currency type, or a teacher could quote a course in a level.
      const borrowed = await postCourse(
        { ...COMPLETE, price: { minorUnits: 100, currency: 'beginner' } },
        teacher,
      ).expect(400);
      expect(borrowed.body.details.validation.price).toBeDefined();
    });

    it('offers the currencies a teacher can quote in, in the catalogue order', async () => {
      // The amount box needs a unit beside it, and the unit list comes from the database for
      // the same reason the level picker does: a currency Ops enables is a box that offers it.
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses/currencies')
        .set('Authorization', `Bearer ${teacher}`)
        .expect(200);

      expect(res.body.items).toEqual([
        { code: 'INR', label: 'Indian rupee' },
        { code: 'USD', label: 'US dollar' },
      ]);
    });

    it('does not hand the currency catalogue to a student', async () => {
      // A browsing reader is owed the currency of the course in front of them, which the
      // course row already carries — the picker is a writer's tool.
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses/currencies')
        .set('Authorization', `Bearer ${student}`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('re-prices a draft and clears the price again, both columns together', async () => {
      const id = await createDraft(teacher);
      const priced = await patchCourse(
        id,
        { price: { minorUnits: 9900, currency: 'USD' } },
        teacher,
      ).expect(200);
      expect(priced.body.course.price).toEqual({
        minorUnits: 9900,
        currency: { code: 'USD', label: 'US dollar' },
      });

      const cleared = await patchCourse(id, { price: null }, teacher).expect(200);
      expect(cleared.body.course.price).toBeNull();

      // One field clears both halves: a body that could leave a currency standing over an
      // empty amount is how a shelf comes to say "US dollar" about nothing.
      expect(
        await prisma.course.count({
          where: { id, priceMinorUnits: null, priceCurrencyValueId: null },
        }),
      ).toBe(1);
    });

    it('quotes free when the teacher says zero, and shows it as zero rather than as none', async () => {
      const id = await createDraft(teacher);
      const res = await patchCourse(
        id,
        { price: { minorUnits: 0, currency: 'INR' } },
        teacher,
      ).expect(200);

      expect(res.body.course.price).toEqual({
        minorUnits: 0,
        currency: { code: 'INR', label: 'Indian rupee' },
      });
    });

    it('leaves a price alone when the body does not mention it', async () => {
      const id = await createDraft(teacher);
      await patchCourse(id, { price: RUPEE }, teacher).expect(200);

      const res = await patchCourse(id, { title: 'Fractions, third edition' }, teacher).expect(200);
      expect(res.body.course.price?.minorUnits).toBe(499900);
      expect(res.body.course.title).toBe('Fractions, third edition');
    });

    it('holds a price still on a published course, the same refusal as a title', async () => {
      const id = await createDraft(teacher);
      await patchCourse(id, { ...COMPLETE, price: RUPEE }, teacher).expect(200);
      await transition(id, 'publish', teacher).expect(200);

      // A student reading ₹4,999 on the shelf is reading a promise, and this is the same rule
      // that stops a title moving under them: the change goes through archive.
      await patchCourse(id, { price: { minorUnits: 1, currency: 'INR' } }, teacher).expect(409);

      const unchanged = await getCourse(id, teacher).expect(200);
      expect(unchanged.body.course.price?.minorUnits).toBe(499900);
    });
  });
});
