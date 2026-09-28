import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { WriteRecorder } from '../action-log/action-recorder';

/**
 * Subjects come back in the catalogue's order, not the order a teacher pasted them, so
 * two profiles listing the same subjects read the same way in a search result.
 */
const WITH_SUBJECTS = {
  subjects: {
    where: { isActive: true },
    include: { subject: { select: { code: true, label: true } } },
    orderBy: { subject: { position: 'asc' } },
  },
} as const satisfies Prisma.TeacherProfileInclude;

export type ProfileWithSubjects = Prisma.TeacherProfileGetPayload<{
  include: typeof WITH_SUBJECTS;
}>;

/** What a save decides, already translated into lookup ids. */
export interface ProfileFields {
  headline: string;
  bio: string | null;
  hourlyRateMinorUnits: number | null;
  currencyCode: string | null;
  subjectValueIds: string[];
}

/**
 * Reads and writes the teacher's public document. The subject set is synchronised rather
 * than replaced because a removed subject is a business transition with a date: the row
 * stays, deactivated, and the same row is revived if the teacher changes their mind, which
 * is what keeps `@@unique([profileId, subjectValueId])` honest under a no-hard-delete rule.
 */
@Injectable()
export class TeacherProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForUser(userId: string): Promise<ProfileWithSubjects | null> {
    return this.prisma.teacherProfile.findUnique({
      where: { userId },
      include: WITH_SUBJECTS,
    });
  }

  /**
   * The one save, in one transaction.
   *
   * The zone is the account's column and the document's field, so it moves here rather than in a
   * call of its own before this one: a teacher who changed the headline and the zone made one
   * decision, and the record of it has to describe a profile and an account that agree. A save
   * that left the zone alone passes `null` and does not touch the account row, so the account is
   * not stamped with an instant nothing moved at.
   */
  async save(
    userId: string,
    fields: ProfileFields,
    timezone: string | null,
    record?: WriteRecorder<ProfileWithSubjects>,
  ): Promise<ProfileWithSubjects> {
    return this.prisma.$transaction(async (tx) => {
      const { subjectValueIds, ...columns } = fields;

      if (timezone !== null) {
        await tx.user.update({ where: { id: userId }, data: { timezone } });
      }

      const profile = await tx.teacherProfile.upsert({
        where: { userId },
        create: { userId, ...columns },
        update: columns,
      });

      await tx.teacherSubject.updateMany({
        where: {
          profileId: profile.id,
          isActive: true,
          subjectValueId: { notIn: subjectValueIds },
        },
        data: { isActive: false, deletedAt: new Date() },
      });

      for (const subjectValueId of subjectValueIds) {
        await tx.teacherSubject.upsert({
          where: {
            profileId_subjectValueId: { profileId: profile.id, subjectValueId },
          },
          create: { profileId: profile.id, subjectValueId },
          update: { isActive: true, deletedAt: null },
        });
      }

      // Read back after the subject rows settle, so what the record is filed from is the document
      // as it now stands rather than the row as it was when the upsert returned.
      const saved = await tx.teacherProfile.findUniqueOrThrow({
        where: { id: profile.id },
        include: WITH_SUBJECTS,
      });
      await record?.(tx, saved);

      return saved;
    });
  }
}
