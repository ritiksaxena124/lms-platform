import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export type CourseWithVocabulary = Prisma.CourseGetPayload<{
  include: typeof WITH_VOCABULARY;
}>;

/** Level and status travel with every course the API returns, code and label together:
 * a portal that only received the code would have to keep its own translation table, and
 * that table is the one thing a lookup is supposed to make unnecessary. */
const WITH_VOCABULARY = {
  level: { select: { code: true, label: true } },
  status: { select: { code: true, label: true } },
} as const satisfies Prisma.CourseInclude;

/** Columns a writer may set. Lookup ids are resolved before this point, so the repository
 * never sees a business code. */
export interface CourseColumns {
  title: string;
  slug: string;
  summary: string | null;
  description: string | null;
  levelValueId: string;
}

/**
 * Every read and write here is scoped by `teacherUserId` in the `where` clause rather than
 * checked afterwards, so ownership is not a step a later endpoint can forget to call. A
 * row that belongs to someone else and a row that does not exist produce the same answer,
 * which is the point: the database is not asked to confirm that the first one is there.
 */
@Injectable()
export class CoursesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(teacherUserId: string, columns: CourseColumns, statusValueId: string) {
    return this.prisma.course.create({
      data: { teacherUserId, statusValueId, ...columns },
      include: WITH_VOCABULARY,
    });
  }

  async listForTeacher(teacherUserId: string, statusValueId: string | null) {
    return this.prisma.course.findMany({
      where: { teacherUserId, isActive: true, ...(statusValueId ? { statusValueId } : {}) },
      include: WITH_VOCABULARY,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A course the caller owns, or nothing. The `teacherUserId` is part of the key rather
   * than a check afterwards, so an endpoint cannot read what it was not given. */
  async findOwned(teacherUserId: string, id: string) {
    return this.prisma.course.findFirst({
      where: { id, teacherUserId, isActive: true },
      include: WITH_VOCABULARY,
    });
  }

  async slugTakenBy(teacherUserId: string, slug: string, exceptCourseId?: string) {
    return this.prisma.course.count({
      where: { teacherUserId, slug, ...(exceptCourseId ? { id: { not: exceptCourseId } } : {}) },
    });
  }

  async updateColumns(id: string, columns: Partial<CourseColumns>) {
    return this.prisma.course.update({ where: { id }, data: columns, include: WITH_VOCABULARY });
  }

  async updateStatus(id: string, statusValueId: string) {
    return this.prisma.course.update({
      where: { id },
      data: { statusValueId },
      include: WITH_VOCABULARY,
    });
  }
}
