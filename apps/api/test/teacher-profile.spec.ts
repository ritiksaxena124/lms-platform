import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

let app: INestApplication;
const prisma = new PrismaClient();

/** Everything the teacher form sends. A `PUT` replaces this whole document. */
const PROFILE = {
  headline: 'CBSE and IB maths, ten years of boards batches',
  bio: 'I teach from the syllabus outward: first what the exam asks for, then the maths behind it.',
  subjects: ['mathematics', 'physics'],
  timezone: 'Asia/Kolkata',
  hourlyRateMinorUnits: 120000,
  currency: 'INR',
};

async function tokenFor(name: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: emailFor(name), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

function getProfile(token?: string): request.Test {
  const call = request(app.getHttpServer()).get('/api/v1/teacher/profile');
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

function putProfile(body: object, token: string): request.Test {
  return request(app.getHttpServer())
    .put('/api/v1/teacher/profile')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function profileRowCount(): Promise<number> {
  return prisma.teacherProfile.count({ where: { user: { email: { contains: `.${RUN}@` } } } });
}

describe('teacher profile', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    app = await createTestApp({ imports: [AppModule] });
    for (const [name, role] of [
      ['tessa', 'teacher'],
      ['sam', 'student'],
    ] as const) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: emailFor(name), password: PASSWORD, fullName: 'Profile Test', role });
      if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    }
  });

  afterAll(async () => {
    await app?.close();
    // Children first: nothing here is ever hard-deleted by the application, so a test
    // cleanup has to walk the same order the schema's Restrict keys allow.
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.teacherSubject.deleteMany({ where: { profile: { userId: { in: userIds } } } });
    await prisma.teacherProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('has no profile until the teacher saves one', async () => {
    const res = await getProfile(await tokenFor('tessa')).expect(200);

    expect(res.body.profile).toBeNull();
  });

  it('refuses to answer without a token', async () => {
    const res = await getProfile().expect(401);

    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('refuses a student the teacher routes', async () => {
    const res = await getProfile(await tokenFor('sam')).expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('saves the profile and reads it back', async () => {
    const token = await tokenFor('tessa');
    await putProfile(PROFILE, token).expect(200);

    const res = await getProfile(token).expect(200);
    expect(res.body.profile).toMatchObject({
      headline: PROFILE.headline,
      bio: PROFILE.bio,
      timezone: 'Asia/Kolkata',
      hourlyRateMinorUnits: 120000,
      currency: 'INR',
    });
    expect(res.body.profile.subjects.map((subject: { code: string }) => subject.code)).toEqual(
      PROFILE.subjects,
    );
  });

  it('keeps the rate in minor units, because a float is how a rupee goes missing', async () => {
    const token = await tokenFor('tessa');
    const res = await putProfile(
      { ...PROFILE, hourlyRateMinorUnits: 1, currency: 'INR' },
      token,
    ).expect(200);

    expect(res.body.profile.hourlyRateMinorUnits).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/"hourlyRate\w*":\s*\d+\.\d+/);

    await putProfile(PROFILE, token).expect(200);
  });

  it('writes the working timezone onto the account rather than a second copy', async () => {
    const token = await tokenFor('tessa');
    await putProfile({ ...PROFILE, timezone: 'Asia/Calcutta' }, token).expect(200);

    // One source of truth: /auth/me and the profile must agree without a sync step.
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.user.timezone).toBe('Asia/Calcutta');

    await putProfile(PROFILE, token).expect(200);
  });

  it('replaces the subject set instead of growing it', async () => {
    const token = await tokenFor('tessa');
    await putProfile({ ...PROFILE, subjects: ['mathematics', 'physics'] }, token).expect(200);
    await putProfile({ ...PROFILE, subjects: ['english'] }, token).expect(200);

    const res = await getProfile(token).expect(200);
    expect(res.body.profile.subjects).toHaveLength(1);
    expect(res.body.profile.subjects[0]).toMatchObject({ code: 'english' });
    // A label travels with the code so the portal never keeps its own translation table.
    expect(res.body.profile.subjects[0].label).toBeTruthy();
  });

  it('orders subjects by the catalogue, not by the order they were typed', async () => {
    const token = await tokenFor('tessa');
    // Reverse the seed order: the response must come back as mathematics, physics anyway,
    // because Ops decides how a subject list reads and a client must not be able to edit it.
    await putProfile({ ...PROFILE, subjects: ['physics', 'mathematics'] }, token).expect(200);

    const res = await getProfile(token).expect(200);
    expect(res.body.profile.subjects.map((subject: { code: string }) => subject.code)).toEqual([
      'mathematics',
      'physics',
    ]);
  });

  it('keeps one profile row per teacher across saves', async () => {
    const token = await tokenFor('tessa');
    const before = await profileRowCount();

    await putProfile(PROFILE, token).expect(200);
    await putProfile({ ...PROFILE, headline: 'A shorter line' }, token).expect(200);

    expect(await profileRowCount()).toBe(before);
  });

  it('reports an unknown subject as a field error the form can show', async () => {
    const token = await tokenFor('tessa');
    const res = await putProfile({ ...PROFILE, subjects: ['quidditch'] }, token).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.validation.subjects).toBeDefined();
  });

  it('refuses an empty subject list', async () => {
    const token = await tokenFor('tessa');
    const res = await putProfile({ ...PROFILE, subjects: [] }, token).expect(400);

    expect(res.body.details.validation.subjects).toBeDefined();
  });

  it('requires a currency wherever a rate appears', async () => {
    const token = await tokenFor('tessa');
    const res = await putProfile(
      { ...PROFILE, hourlyRateMinorUnits: 90000, currency: undefined },
      token,
    ).expect(400);

    expect(res.body.details.validation.currency).toBeDefined();
  });

  it('refuses a rate that is not a whole number of minor units', async () => {
    const token = await tokenFor('tessa');
    const res = await putProfile({ ...PROFILE, hourlyRateMinorUnits: 90000.5 }, token).expect(400);

    expect(res.body.details.validation.hourlyRateMinorUnits).toBeDefined();
  });

  it('refuses a timezone that is not a real zone', async () => {
    const token = await tokenFor('tessa');
    const res = await putProfile({ ...PROFILE, timezone: 'Mars/Olympus_Mons' }, token).expect(400);

    expect(res.body.details.validation.timezone).toBeDefined();
  });

  it('answers a student who tries to write, not just read', async () => {
    const res = await putProfile(PROFILE, await tokenFor('sam')).expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
    expect(await profileRowCount()).toBe(1);
  });
});
