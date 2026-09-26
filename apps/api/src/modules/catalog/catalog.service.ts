import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LESSON_STATUS_CODES,
  LKP_TYPE_CODES,
  type CatalogCourse,
  type CatalogCourseDetail,
  type CatalogListInput,
  type CatalogModule,
  type CourseChoice,
} from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import type { CatalogFilters, CourseCardRow, CourseSyllabusRow } from './catalog.repository';
import { CatalogRepository } from './catalog.repository';

/** A course row is addressed by its id and nothing else, so this is the whole of it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE_SIZE = 12;

/**
 * A card's counts, worked out here rather than in SQL.
 *
 * The module list a card counted and the syllabus a detail shows come from the same two
 * rules — a retired block is out, and so is a block with nothing readable in it — so the
 * number on a card is the number of blocks the page will list, not the number the teacher
 * once created.
 */
function readableModules(course: CourseCardRow): number[] {
  return course.modules
    .map((module) => module._count.lessons)
    .filter((lessons) => lessons > 0);
}

function toCard(course: CourseCardRow): CatalogCourse {
  const modules = readableModules(course);

  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    summary: course.summary,
    level: { code: course.level.code, label: course.level.label },
    teacher: { displayName: course.teacher.fullName },
    moduleCount: modules.length,
    lessonCount: modules.reduce((total, lessons) => total + lessons, 0),
    updatedAt: course.updatedAt.toISOString(),
  };
}

function toDetail(course: CourseSyllabusRow): CatalogCourseDetail {
  const modules: CatalogModule[] = course.modules
    .filter((module) => module.lessons.length > 0)
    .map((module) => ({
      id: module.id,
      title: module.title,
      summary: module.summary,
      position: module.position,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
        estimatedMinutes: lesson.estimatedMinutes,
      })),
    }));

  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    summary: course.summary,
    description: course.description,
    level: { code: course.level.code, label: course.level.label },
    teacher: { displayName: course.teacher.fullName },
    modules,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

/**
 * The catalog: published courses, and inside them only what a student may already read.
 *
 * Both gates are applied here, and they are the reason this is a service of its own rather
 * than a query string on the teacher's list. The outer one is the course's — a draft or an
 * archived course is not in this catalogue at all, and answers `NOT_FOUND` the way the
 * teacher's routes answer a course that is not theirs. The inner one is the lesson's — a
 * published page inside a live course is still invisible until its own flag is open, which
 * is what lets a teacher pull a half-written page out without archiving the course around it.
 *
 * Neither gate is a permission check, because there is nobody to check. This is the one
 * surface in the API with no session, so the only identity here is the row's own status.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly reference: ReferenceService,
  ) {}

  async list(input: CatalogListInput): Promise<{
    items: CatalogCourse[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    const filters = await this.filters(input);

    const { courses, total } = await this.catalog.page(
      filters,
      (page - 1) * pageSize,
      pageSize,
    );

    return { items: courses.map(toCard), page, pageSize, total };
  }

  /** The levels a course can be filtered by, in the order the catalogue sets. A browsing
   * student asks this rather than carrying three strings of their own — the same argument the
   * teacher's picker makes, made again because this is a different audience that cannot reach
   * the teacher's routes. */
  async levels(): Promise<CourseChoice[]> {
    const values = await this.reference.activeValues(LKP_TYPE_CODES.COURSE_LEVEL);
    return values.map(({ code, label }) => ({ code, label }));
  }

  async read(id: string): Promise<CatalogCourseDetail> {
    const course = UUID.test(id)
      ? await this.catalog.findPublished(id, await this.filters({}))
      : null;

    if (!course) {
      // One message for "not published", "retired" and "never there": a browser that could
      // tell them apart has a list of draft courses to work from.
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that course.',
      });
    }

    return toDetail(course);
  }

  /** The two published statuses, plus the level and phrase a caller filtered on. Codes are
   * resolved at this edge, so the repository only ever sees lookup ids. */
  private async filters(input: CatalogListInput): Promise<CatalogFilters> {
    const [courseStatus, lessonStatus] = await Promise.all([
      this.reference.valueId(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.PUBLISHED),
      this.reference.valueId(LKP_TYPE_CODES.LESSON_STATUS, LESSON_STATUS_CODES.PUBLISHED),
    ]);

    return {
      courseStatusValueId: courseStatus,
      lessonStatusValueId: lessonStatus,
      levelValueId: input.level ? await this.level(input.level) : null,
      search: input.q ?? null,
    };
  }

  /** A level the catalogue does not carry is the browser's mistake, not the API's, so it
   * comes back as a field error rather than a page that looks empty on purpose. */
  private async level(code: string): Promise<string> {
    const [value] = await this.reference.valuesByCodes(LKP_TYPE_CODES.COURSE_LEVEL, [code]);
    if (!value) {
      throw new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Check the highlighted fields.',
        details: { validation: { level: [`Not a level we know: ${code}`] } },
      });
    }
    return value.id;
  }
}
