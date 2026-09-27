import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/** The columns a new standing recording arrives with. `isActive` is not one of them: the row
 * this writes *is* the standing one, and the retire below is what makes the other one not. */
export interface NewLessonAsset {
  lessonId: string;
  displayName: string;
  storedKey: string;
  contentType: string;
  bytes: number;
}

/**
 * The recordings attached to lessons.
 *
 * Reads take the standing row — `isActive: true` — which is the whole of what "current" means
 * here; there is no version number and no pointer column to keep in step. Writes take the pair
 * that keeps that reading honest: retire whatever stands, then file the new one, in one
 * transaction, so a lesson is never left with two rows both claiming to be the video a student
 * is served.
 *
 * Two uploads of the same page at the same instant can both pass the retire step and leave two
 * active rows — the database does not forbid it, because a partial unique index written by
 * hand would be dropped by the next `prisma migrate dev`. A teacher replacing a recording twice
 * in one second is not the case worth that trade; the repair is to re-attach, and the next read
 * is the newest row either way.
 */
@Injectable()
export class LessonAssetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findStanding(lessonId: string) {
    return this.prisma.lessonAsset.findFirst({
      where: { lessonId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async replaceStanding(asset: NewLessonAsset) {
    return this.prisma.$transaction(async (tx) => {
      await tx.lessonAsset.updateMany({
        where: { lessonId: asset.lessonId, isActive: true },
        data: { isActive: false },
      });
      return tx.lessonAsset.create({ data: asset });
    });
  }
}
