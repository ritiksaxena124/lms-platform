import { PrismaClient } from '@prisma/client';
import { MAIL_EVENT_CODES } from '@lms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EMAIL_TEMPLATE_SEEDS } from '../src/reference/email-template-data';
import { seedEmailTemplates } from '../src/reference/seed-email-templates';

/**
 * The copy behind the seven send decisions.
 *
 * A queued row names an event and the sweep renders it against a standing `email_template` row, so
 * an event with no row is a letter that cannot be written — and the failure is discovered in 6e's
 * retry loop, in a `failureReason` column, rather than at boot. Seeding the seven is what makes
 * "this platform mails about these things" a fact about the database rather than about a list in
 * the code.
 *
 * Insert-only, for the reason §6 gives for putting the copy there at all: an operator rewording a
 * message is making a change the platform should keep. A seed that wrote the repo's strings back
 * over their edit on the next deploy would silently undo a decision somebody made about their own
 * school's voice.
 */
describe('email template seeding', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await seedEmailTemplates(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('files standing copy for every event the code can queue, and none it cannot', async () => {
    const rows = await prisma.emailTemplate.findMany({ where: { isActive: true } });
    expect(rows.map((row) => row.eventCode).sort()).toEqual(
      [...Object.values(MAIL_EVENT_CODES)].sort(),
    );
  });

  it('gives every event the same row the seed data describes', async () => {
    // The database is the copy a reader gets; this file is what a fresh box is seeded with. A
    // fifth entry here that no event reaches is a message nobody sends, and the seed data is
    // where that would first be visible.
    expect(Object.keys(EMAIL_TEMPLATE_SEEDS).sort()).toEqual(
      [...Object.values(MAIL_EVENT_CODES)].sort(),
    );
  });

  it('writes a subject that stays on one line', async () => {
    // A header line is one line: 6a's port would refuse the message and 6b's renderer refuses it
    // first, so a seeded subject with a break in it would be a row that queues and never sends.
    for (const [eventCode, copy] of Object.entries(EMAIL_TEMPLATE_SEEDS)) {
      expect(copy.subject, eventCode).not.toMatch(/[\r\n]/);
      expect(copy.subject.length, eventCode).toBeLessThanOrEqual(120);
      expect(copy.heading, eventCode).not.toMatch(/[\r\n]/);
      expect(copy.ctaLabel, eventCode).not.toMatch(/[\r\n]/);
    }
  });

  it('gives every body a sentence, in order, with none of them blank', async () => {
    for (const [eventCode, copy] of Object.entries(EMAIL_TEMPLATE_SEEDS)) {
      expect(copy.bodyLines.length, eventCode).toBeGreaterThan(0);
      for (const line of copy.bodyLines) {
        expect(line.trim(), eventCode).toBe(line);
        expect(line.length, eventCode).toBeGreaterThan(0);
      }
    }
  });

  it('asks only for the four answers a send decision can supply', async () => {
    // `{when}` in a row nobody can fill is the drift this seed is most likely to create, because
    // the copy and the payload live in two files. The names here are the whole vocabulary: a class,
    // a course, and the two people in it. Anything else is a slot no transaction has an answer for,
    // and the matching between a row and its payload is the queue's spec to prove.
    const vocabulary = ['student_name', 'teacher_name', 'course_title', 'when'];
    for (const [eventCode, copy] of Object.entries(EMAIL_TEMPLATE_SEEDS)) {
      const found = [copy.subject, copy.heading, copy.ctaLabel, ...copy.bodyLines]
        .join('\n')
        .match(/\{([A-Za-z][A-Za-z0-9_]*)\}/g);
      const names = [...new Set(found?.map((slot) => slot.slice(1, -1)))];

      expect(names.length, eventCode).toBeGreaterThan(0);
      for (const name of names) {
        expect(vocabulary, `${eventCode} asks for {${name}}`).toContain(name);
      }
    }
  });

  it('leaves a reword an operator made exactly as they left it', async () => {
    const eventCode = MAIL_EVENT_CODES.BOOKING_CONFIRMED;
    const original = await prisma.emailTemplate.findUniqueOrThrow({ where: { eventCode } });

    await prisma.emailTemplate.update({
      where: { id: original.id },
      data: { subject: 'Your class is set — from the school', isActive: false },
    });
    await seedEmailTemplates(prisma);

    const after = await prisma.emailTemplate.findUniqueOrThrow({ where: { eventCode } });
    expect(after.subject).toBe('Your class is set — from the school');
    expect(after.isActive).toBe(false);

    await prisma.emailTemplate.update({
      where: { id: original.id },
      data: { subject: original.subject, isActive: original.isActive },
    });
  });
});
