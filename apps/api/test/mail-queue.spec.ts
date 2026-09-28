import type { INestApplication } from '@nestjs/common';
import type { MailOutbox, Prisma, PrismaClient as PrismaClientType } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MAIL_EVENT_CODES,
  MAIL_OUTBOX_STATUS_CODES,
  formatInZone,
  type MailEventCode,
} from '@lms/shared';

import { AppModule } from '../src/app.module';
import { provideEnv } from '../src/config/env.module';
import {
  type BookingNews,
  type EnrollmentNews,
  MailQueue,
} from '../src/modules/notifications/mail-queue.service';
import { seedEmailTemplates } from '../src/reference/seed-email-templates';
import { seedLookups } from '../src/reference/seed-lookups';
import { createTestApp } from './utils/create-test-app';

/**
 * What a send decision writes.
 *
 * Six transactions in the booking and enrollment tables call this; this file is about the one thing
 * they all have to get right, which is that the row they file is a piece of news and not a letter
 * (ARCHITECTURE §6). So the assertions are about the row: who it is addressed to, what the copy will
 * be told, where its button leads — and, just as importantly, what is *not* in it. No address, no
 * room, no claim about delivery.
 *
 * The ids handed to the queue are invented on purpose. A queue that reached back into the booking
 * table to check them would be a second owner of that table, and the transaction that noticed the
 * news already knows they are real: it wrote them.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;
const PASSWORD = 'correct horse battery staple';

/** One instant, seen by two people whose clocks are nowhere near each other. */
const CLASS_START = new Date('2026-03-05T15:30:00.000Z');
const TEACHER_ZONE = 'Asia/Kolkata';
const STUDENT_ZONE = 'America/New_York';

let app: INestApplication;
const prisma: PrismaClientType = new PrismaClient();
const env = provideEnv();
let queue: MailQueue;

let teacherId = '';
let studentId = '';

async function register(name: string, role: string, timezone: string): Promise<string> {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: emailFor(name), password: PASSWORD, fullName: `${name} Person`, role })
    .expect(201);
  const user = await prisma.user.findFirstOrThrow({ where: { email: emailFor(name) } });
  await prisma.user.update({ where: { id: user.id }, data: { timezone } });
  return user.id;
}

/** The facts a class letter is made of, in the shape a booking row carries them. */
function bookingNews(courseId: string = randomUUID()): BookingNews {
  return {
    course: { id: courseId, title: 'Conversation club' },
    student: { id: studentId, fullName: 'Asking Student', timezone: STUDENT_ZONE },
    teacher: { id: teacherId, fullName: 'Answering Teacher', timezone: TEACHER_ZONE },
    startsAt: CLASS_START,
  };
}

function enrollmentNews(courseId: string = randomUUID()): EnrollmentNews {
  return {
    course: { id: courseId, title: 'Conversation club', teacherName: 'Answering Teacher' },
    student: { id: studentId },
  };
}

/** File the news the way a business write does — inside its own transaction, which is what commits
 * it, or un-files it, together with the row that made it. */
function file<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(run);
}

const slotsOf = (row: MailOutbox) => (row.payload as { slots: Record<string, string> }).slots;
const hrefOf = (row: MailOutbox) => (row.payload as { href: string }).href;

/** The `{slot}` names a seeded template asks for, as the sweep will have to answer them. */
async function slotsRequiredBy(eventCode: MailEventCode): Promise<string[]> {
  const template = await prisma.emailTemplate.findUniqueOrThrow({ where: { eventCode } });
  const copy = [template.subject, template.heading, template.ctaLabel ?? '', ...template.bodyLines];
  const found = copy.join('\n').match(/\{([A-Za-z][A-Za-z0-9_]*)\}/g) ?? [];
  return [...new Set(found.map((slot) => slot.slice(1, -1)))].sort();
}

describe('filing a send decision', () => {
  beforeAll(async () => {
    await seedLookups(prisma);
    await seedEmailTemplates(prisma);
    app = await createTestApp({ imports: [AppModule] });
    queue = app.get(MailQueue);
    teacherId = await register('mqtr', 'teacher', TEACHER_ZONE);
    studentId = await register('mqst', 'student', STUDENT_ZONE);
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await prisma.user.findMany({
        where: { email: { contains: `.${RUN}@` } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.actionLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('files a request with the teacher and an answer with the student', async () => {
    // The event decides who is told, so a caller cannot address a confirmation to the teacher who
    // wrote it. Both questions a letter answers — who has to act, and who asked — are settled here
    // once rather than at six call sites.
    const asked = await file((tx) =>
      queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_REQUESTED, bookingNews()),
    );
    const answered = await file((tx) =>
      queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_CONFIRMED, bookingNews()),
    );
    const left = await file((tx) =>
      queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_CANCELLED, bookingNews()),
    );

    expect(asked.recipientUserId).toBe(teacherId);
    expect(answered.recipientUserId).toBe(studentId);
    expect(left.recipientUserId).toBe(teacherId);
  });

  it('names the other person, and says the minute in the reader’s own clock', async () => {
    const [asked, answered] = await file(async (tx) => [
      await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_REQUESTED, bookingNews()),
      await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_CONFIRMED, bookingNews()),
    ]);

    // A teacher is told who is asking; a student is told who said yes. Nobody reads a letter about
    // themselves in the third person, and nobody needs to be told their own name.
    expect(slotsOf(asked).student_name).toBe('Asking Student');
    expect(slotsOf(asked).teacher_name).toBeUndefined();
    expect(slotsOf(answered).teacher_name).toBe('Answering Teacher');
    expect(slotsOf(answered).student_name).toBeUndefined();

    // §5's rule about clocks, applied to a sentence: one instant, written twice, once for each
    // reader. `when` is the only time a message carries, and it is the reader's.
    expect(slotsOf(asked).when).toBe(formatInZone(CLASS_START, TEACHER_ZONE).label);
    expect(slotsOf(answered).when).toBe(formatInZone(CLASS_START, STUDENT_ZONE).label);
    expect(slotsOf(asked).when).not.toBe(slotsOf(answered).when);
  });

  it('sends each event to the one page of the portal that holds the news', async () => {
    const courseId = randomUUID();
    const rows = await file(async (tx) => ({
      requested: await queue.aboutBooking(
        tx,
        MAIL_EVENT_CODES.BOOKING_REQUESTED,
        bookingNews(courseId),
      ),
      confirmed: await queue.aboutBooking(
        tx,
        MAIL_EVENT_CODES.BOOKING_CONFIRMED,
        bookingNews(courseId),
      ),
      refused: await queue.aboutBooking(
        tx,
        MAIL_EVENT_CODES.BOOKING_REFUSED,
        bookingNews(courseId),
      ),
      expired: await queue.aboutBooking(
        tx,
        MAIL_EVENT_CODES.BOOKING_EXPIRED,
        bookingNews(courseId),
      ),
      cancelled: await queue.aboutBooking(
        tx,
        MAIL_EVENT_CODES.BOOKING_CANCELLED,
        bookingNews(courseId),
      ),
      joined: await queue.aboutEnrollment(
        tx,
        MAIL_EVENT_CODES.ENROLLMENT_JOINED,
        enrollmentNews(courseId),
      ),
      left: await queue.aboutEnrollment(
        tx,
        MAIL_EVENT_CODES.ENROLLMENT_LEFT,
        enrollmentNews(courseId),
      ),
    }));

    // Every destination is a page that asks who is calling before it shows anything — which is what
    // lets a message carry a link at all. A room address has no page like that, and is not
    // reachable from here: an href is an env origin plus segments this file names.
    expect(hrefOf(rows.requested)).toBe(`${env.TEACHER_PORTAL_URL}/requests`);
    expect(hrefOf(rows.cancelled)).toBe(`${env.TEACHER_PORTAL_URL}/classes`);
    expect(hrefOf(rows.confirmed)).toBe(`${env.STUDENT_PORTAL_URL}/my-classes`);
    expect(hrefOf(rows.refused)).toBe(`${env.STUDENT_PORTAL_URL}/courses/${courseId}/book`);
    expect(hrefOf(rows.expired)).toBe(`${env.STUDENT_PORTAL_URL}/courses/${courseId}/book`);
    expect(hrefOf(rows.joined)).toBe(`${env.STUDENT_PORTAL_URL}/courses/${courseId}`);
    expect(hrefOf(rows.left)).toBe(`${env.STUDENT_PORTAL_URL}/my-courses`);
  });

  it('refuses to let an id turn the portal origin into somebody else’s host', async () => {
    // `%2F` is all that survives of a path separator, so the worst thing a caller can hand this code
    // is a string that would otherwise walk out of the portal it started in.
    const row = await file((tx) =>
      queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_EXPIRED, bookingNews('x/../../evil.example')),
    );

    const url = new URL(hrefOf(row));
    expect(url.origin).toBe(env.STUDENT_PORTAL_URL);
    expect(url.hostname).not.toContain('evil.example');
  });

  it('holds who to tell and never the address to tell', async () => {
    const row = await file((tx) =>
      queue.aboutEnrollment(tx, MAIL_EVENT_CODES.ENROLLMENT_JOINED, enrollmentNews()),
    );

    // A mail address is personal data, and 6a's port promised the outbox owns the address book: the
    // sweep reads it from the user row at delivery time. A row that stored it would keep a person's
    // address after they changed it, and would put it in a table a report could join.
    expect(row.recipientUserId).toBe(studentId);
    expect(JSON.stringify(row)).not.toContain(emailFor('mqst'));
    expect(Object.keys(row).sort()).toEqual(
      [
        'id',
        'eventCode',
        'payload',
        'recipientUserId',
        'status',
        'attempts',
        'nextAttemptAt',
        'sentAt',
        'failureReason',
        'isActive',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(slotsOf(row)).toEqual({
      course_title: 'Conversation club',
      teacher_name: 'Answering Teacher',
    });
  });

  it('says nothing about delivery, because nothing has happened yet', async () => {
    const row = await file((tx) =>
      queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_REQUESTED, bookingNews()),
    );

    // `queued` and due-now are the column defaults 6c chose, so the queue states nothing about when
    // or whether this gets sent. A deployment with no transport (`delivers: false`) reads the same
    // row and drops it; a row that had already claimed to be sent would be the one lie this table
    // cannot tell.
    expect(row.status).toBe(MAIL_OUTBOX_STATUS_CODES.QUEUED);
    expect(row.attempts).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(row.failureReason).toBeNull();
    expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('un-files the news when the write that made it does not land', async () => {
    // The whole reason there is an outbox rather than a direct send: the row is part of the business
    // transaction, so a booking that rolled back cannot leave a letter behind about it.
    const before = await prisma.mailOutbox.count({ where: { recipientUserId: teacherId } });

    await expect(
      prisma.$transaction(async (tx) => {
        await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_REQUESTED, bookingNews());
        throw new Error('the class row failed');
      }),
    ).rejects.toThrow('the class row failed');

    expect(await prisma.mailOutbox.count({ where: { recipientUserId: teacherId } })).toBe(before);
  });

  it('answers every slot its own copy asks for, for all seven events', async () => {
    const courseId = randomUUID();
    const news = bookingNews(courseId);
    const place = enrollmentNews(courseId);
    const rows = await file(async (tx) => [
      await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_REQUESTED, news),
      await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_CONFIRMED, news),
      await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_REFUSED, news),
      await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_EXPIRED, news),
      await queue.aboutBooking(tx, MAIL_EVENT_CODES.BOOKING_CANCELLED, news),
      await queue.aboutEnrollment(tx, MAIL_EVENT_CODES.ENROLLMENT_JOINED, place),
      await queue.aboutEnrollment(tx, MAIL_EVENT_CODES.ENROLLMENT_LEFT, place),
    ]);

    // The copy and the payload are written in two files with no join between them, so this is where
    // a `{when}` nobody answers gets caught: at the send decision, not in 6e's retry loop. Both
    // directions matter — a slot the copy asks for and the payload withholds is a message with a
    // hole in it, and an answer the copy never asks for is a value somebody filed for no reason.
    expect(rows.map((row) => row.eventCode).sort()).toEqual(
      [...(Object.values(MAIL_EVENT_CODES) as MailEventCode[])].sort(),
    );

    for (const row of rows) {
      expect(Object.keys(slotsOf(row)).sort(), row.eventCode).toEqual(
        await slotsRequiredBy(row.eventCode as MailEventCode),
      );
      expect(hrefOf(row), row.eventCode).toBeTruthy();
    }
  });
});
