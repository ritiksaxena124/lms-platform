import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The catalog's two reads, and the only place in this app where a course is described by
 * what a stranger may see rather than by what its author may change.
 *
 * `isActive` and the two published statuses are written into the `where` clauses here, so a
 * route cannot answer with a draft by forgetting a check afterwards — the same argument the
 * teacher-side repositories make about ownership, pointed at the publish gates instead.
 */

/** A course page: level and teacher travel as code plus label, so no portal keeps a
 * translation table that goes stale the day Ops renames a tier. */
const CARD_INCLUDE = (lessonStatusValueId: string) =>
  ({
    level: { select: { code: true, label: true } },
    teacher: { select: { fullName: true } },
    modules: {
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: {
        _count: {
          select: { lessons: { where: { isActive: true, statusValueId: lessonStatusValueId } } },
        },
      },
    },
  }) as const satisfies Prisma.CourseInclude;

/** The syllabus as a student is shown it: active blocks, and inside each one only the
 * pages whose own gate is open. `body` is not selected anywhere in this file — reading a
 * page is enrollment's business, and the query is where that is decided. */
const SYLLABUS_INCLUDE = (lessonStatusValueId: string) =>
  ({
    level: { select: { code: true, label: true } },
    teacher: { select: { fullName: true } },
    modules: {
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        title: true,
        summary: true,
        position: true,
        lessons: {
          where: { isActive: true, statusValueId: lessonStatusValueId },
          orderBy: { position: 'asc' },
          select: { id: true, title: true, position: true, estimatedMinutes: true },
        },
      },
    },
  }) as const satisfies Prisma.CourseInclude;

export type CourseCardRow = Prisma.CourseGetPayload<{ include: ReturnType<typeof CARD_INCLUDE> }>;
export type CourseSyllabusRow = Prisma.CourseGetPayload<{
  include: ReturnType<typeof SYLLABUS_INCLUDE>;
}>;

export interface CatalogFilters {
  courseStatusValueId: string;
  lessonStatusValueId: string;
  levelValueId: string | null;
  search: string | null;
}

export interface CatalogPage {
  courses: CourseCardRow[];
  total: number;
}

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of the catalog, and how many courses the filter matched in total.
   *
   * Newest first: a student comparing three teachers has no reason to meet the oldest
   * course on the platform first, and any order keyed on quality is a ranking this phase
   * has no signal to compute.
   */
  async page(
    filters: CatalogFilters,
    skip: number,
    take: number,
  ): Promise<CatalogPage> {
    const where: Prisma.CourseWhereInput = {
      isActive: true,
      statusValueId: filters.courseStatusValueId,
      ...(filters.levelValueId ? { levelValueId: filters.levelValueId } : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: 'insensitive' } },
              { summary: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [courses, total] = await Promise.all([
      this.prisma.course.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: CARD_INCLUDE(filters.lessonStatusValueId),
      }),
      this.prisma.course.count({ where }),
    ]);

    return { courses, total };
  }

  /** A published course, or nothing. Anything else — a draft, an archive, a typo — is the
   * same answer, which is the point of a catalog that cannot be walked with a list. */
  async findPublished(id: string, filters: CatalogFilters) {
    const course = await this.prisma.course.findFirst({
      where: { id, isActive: true, statusValueId: filters.courseStatusValueId },
      include: SYLLABUS_INCLUDE(filters.lessonStatusValueId),
    });
    return course;
  }
}
