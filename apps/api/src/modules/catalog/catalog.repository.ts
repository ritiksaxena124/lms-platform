import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The catalog's reads, and the only place in this app where a course is described by what a
 * stranger may see rather than by what its author may change.
 *
 * `isActive` and the published statuses are written into the `where` clauses here, so a
 * route cannot answer with a draft by forgetting a check afterwards — the same argument the
 * teacher-side repositories make about ownership, pointed at the publish gates instead. It
 * is also why the free-page read below carries all three gates in one query: the third gate
 * is only a door if the two above it are open, and a reader must not be able to get that
 * wrong by asking for the lesson alone.
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
 * pages whose own gate is open. The rows are named and not opened — `body` is selected by
 * exactly one query below, the one that has already proved all three gates — so the map of a
 * course is the same shape whether or not any room on it happens to be unlocked. */
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
          select: {
            id: true,
            title: true,
            position: true,
            estimatedMinutes: true,
            isFreePreview: true,
          },
        },
      },
    },
  }) as const satisfies Prisma.CourseInclude;

export type CourseCardRow = Prisma.CourseGetPayload<{ include: ReturnType<typeof CARD_INCLUDE> }>;
export type CourseSyllabusRow = Prisma.CourseGetPayload<{
  include: ReturnType<typeof SYLLABUS_INCLUDE>;
}>;

/** The one page a student may open, and the two places it hangs from. */
const FREE_LESSON_SELECT = {
  id: true,
  title: true,
  body: true,
  estimatedMinutes: true,
  position: true,
  isFreePreview: true,
  updatedAt: true,
  module: {
    select: {
      id: true,
      title: true,
      position: true,
      course: { select: { id: true, slug: true, title: true } },
    },
  },
} as const satisfies Prisma.LessonSelect;

export type FreeLessonRow = Prisma.LessonGetPayload<{
  select: typeof FREE_LESSON_SELECT;
}>;

/** A course as a browser addressed it: the id the API issued, or the slug its author chose.
 * Both name one row, so the two must never answer differently. */
export type CatalogCourseRef = { id: string } | { slug: string };

export interface CatalogFilters {  courseStatusValueId: string;
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
  async findPublished(ref: CatalogCourseRef, filters: CatalogFilters) {
    const course = await this.prisma.course.findFirst({
      where: { ...ref, isActive: true, statusValueId: filters.courseStatusValueId },
      include: SYLLABUS_INCLUDE(filters.lessonStatusValueId),
    });
    return course;
  }

  /**
   * One page a teacher marked free to read, with its body.
   *
   * All three gates are in this single query rather than compared after the fact: the row
   * must be free, published and live; its module live; its course published and live. A
   * lesson that fails any of them returns nothing at all, which is what lets the service
   * give the same 404 for "locked", "draft", "not yours to show" and "never written".
   */
  async findFreeLesson(ref: CatalogCourseRef, lessonId: string, filters: CatalogFilters) {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isActive: true,
        isFreePreview: true,
        statusValueId: filters.lessonStatusValueId,
        module: {
          isActive: true,
          course: { ...ref, isActive: true, statusValueId: filters.courseStatusValueId },
        },
      },
      select: FREE_LESSON_SELECT,
    });
    return lesson;
  }
}
