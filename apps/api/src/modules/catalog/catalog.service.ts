import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  API_ERROR_CODES,
  COURSE_STATUS_CODES,
  LESSON_STATUS_CODES,
  LKP_TYPE_CODES,
  type CatalogCourse,
  type CatalogCourseDetail,
  type CatalogLessonModule,
  type CatalogLessonPage,
  type CatalogListInput,
  type CatalogModule,
  type CourseChoice,
} from '@lms/shared';

import { ReferenceService } from '../../reference/reference.service';
import type {
  CatalogCourseRef,
  CatalogFilters,
  CourseCardRow,
  CourseSyllabusRow,
  ReadableLessonRow,
} from './catalog.repository';
import { CatalogRepository } from './catalog.repository';

/**
 * A course is addressed two ways: the id the API issued, and the slug its author chose for
 * links. This decides which one a caller meant. A non-UUID is read as a slug rather than
 * refused, since a slug is written by hand and pasted into a URL — and both spellings reach
 * one row, which is the property the tests keep them to.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const courseRef = (address: string): CatalogCourseRef =>
  UUID.test(address) ? { id: address } : { slug: address };

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

function toDetail(course: CourseSyllabusRow, holdsPlace: boolean): CatalogCourseDetail {
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
        isFreePreview: lesson.isFreePreview,
        // Two doors, one flag: what the teacher opened for anybody, and what this reader's own
        // place opens for them. Nothing else about the row changes between the two readers —
        // a syllabus is a map, and a map that rearranged itself per caller is not a map.
        isReadable: lesson.isFreePreview || holdsPlace,
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

/** The module and course a page hangs from, sent with it because a reader who arrived here
 * from a link has no syllabus on screen and needs both to go back. The block is listed with
 * its position rather than its whole syllabus: enough to say where the reader is and how to
 * get back to the outline, not enough to rebuild it. */
function toLessonPage(lesson: ReadableLessonRow): CatalogLessonPage {
  const module: CatalogLessonModule = {
    id: lesson.module.id,
    title: lesson.module.title,
    position: lesson.module.position,
  };

  return {
    id: lesson.id,
    title: lesson.title,
    body: lesson.body,
    estimatedMinutes: lesson.estimatedMinutes,
    position: lesson.position,
    // The row's own statement, not a constant: a page that opened because of an enrollment
    // is not one the teacher marked free, and a badge that said so would be a lie about
    // which door the reader came through.
    isFreePreview: lesson.isFreePreview,
    updatedAt: lesson.updatedAt.toISOString(),
    module,
    course: {
      id: lesson.module.course.id,
      slug: lesson.module.course.slug,
      title: lesson.module.course.title,
    },
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
 * Neither gate is a permission check. The shelf and the level list have nobody to check at
 * all — this is the surface in the API a browser reads with no session — so the only identity
 * in them is the row's own status.
 *
 * A third flag, `isFreePreview`, is not a gate on this visibility: it decides whether one
 * published page's body can be opened, and never whether the row appears on the syllabus.
 * That is why marking a page free changes nothing about the outline's shape.
 *
 * Two routes here do have a caller: opening a page, and a course's outline. Both ask the same
 * question — free door, or a place in the course (§12)? — and answer it the same way, which is
 * what makes the outline a map a student can trust rather than a list of rows they will click
 * to find out about. Where they differ is what the answer is worth: on the page it decides
 * whether text leaves the database, so it sits inside that query's `where`; on the outline it
 * only sets `isReadable` on rows that are published already. `isFreePreview` travels alongside
 * it unchanged, because it is the teacher's statement about the page rather than a description
 * of how this reader got in — a badge and a door are two different facts.
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

  async read(address: string, viewerId?: string): Promise<CatalogCourseDetail> {
    const course = await this.catalog.findPublished(
      courseRef(address),
      await this.filters({}),
    );

    if (!course) {
      // One message for "not published", "retired" and "never there": a browser that could
      // tell them apart has a list of draft courses to work from.
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that course.',
      });
    }

    // Asked for after the course resolves rather than inside its query, so a stranger's page
    // costs what it always did: one read and no probe for a place nobody holds.
    const holdsPlace = viewerId ? await this.catalog.holdsPlace(course.id, viewerId) : false;

    return toDetail(course, holdsPlace);
  }

  /**
   * One page, opened — for a stranger if the teacher marked it free, for a student who holds
   * a place in the course otherwise.
   *
   * The repository's query has already decided every gate, so everything that comes back
   * `null` here gets the same answer an invented id gets. The message differs from the
   * course's on purpose — "that page" is honest about which half of the address was wrong,
   * and says nothing about whether the page exists.
   */
  async lesson(
    address: string,
    lessonId: string,
    viewerId?: string,
  ): Promise<CatalogLessonPage> {
    const lesson = UUID.test(lessonId)
      ? await this.catalog.findReadable(
          courseRef(address),
          lessonId,
          await this.filters({}),
          viewerId,
        )
      : null;

    if (!lesson) {
      throw new NotFoundException({
        code: API_ERROR_CODES.NOT_FOUND,
        message: 'We cannot find that page.',
      });
    }

    return toLessonPage(lesson);
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
