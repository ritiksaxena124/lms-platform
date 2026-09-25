import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

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

  async save(userId: string, fields: ProfileFields): Promise<ProfileWithSubjects> {
    return this.prisma.$transaction(async (tx) => {
      const { subjectValueIds, ...columns } = fields;

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

      return tx.teacherProfile.findUniqueOrThrow({
        where: { id: profile.id },
        include: WITH_SUBJECTS,
      });
    });
  }
}
