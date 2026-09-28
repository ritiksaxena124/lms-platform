import type { PrismaClient } from '@prisma/client';

import { EMAIL_TEMPLATE_SEEDS } from './email-template-data';

/**
 * Files the copy for the send decisions this platform makes.
 *
 * Insert-only, like `seedLookups`, and for a reason that matters more here than it does for a
 * status label: the copy lives in this table because an operator is meant to change it (§6). A seed
 * that wrote these strings back over a school's reworded confirmation would undo a decision somebody
 * made about their own voice, quietly, on the day they deployed.
 *
 * So a re-run changes nothing about a row that exists — including a deactivated one, which is the
 * event having stopped being worth sending rather than a row the seed never reached.
 */
export async function seedEmailTemplates(prisma: PrismaClient): Promise<void> {
  for (const [eventCode, copy] of Object.entries(EMAIL_TEMPLATE_SEEDS)) {
    await prisma.emailTemplate.upsert({
      where: { eventCode },
      create: { eventCode, ...copy },
      update: {},
    });
  }
}
