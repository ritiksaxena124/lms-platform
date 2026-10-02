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
 * is also why the page read below carries every gate in one query: the two published
 * statuses, and whichever door lets this caller in. A door is only a door if the wall behind
 * it is standing, and a reader must not be able to get that wrong by asking for a lesson
 * alone.
 */

/** A course page: level, teacher and the currency of any price travel as code plus label, so
 * no portal keeps a translation table that goes stale the day Ops renames a tier. */
const CARD_INCLUDE = (lessonStatusValueId: string) =>
  ({
    level: { select: { code: true, label: true } },
    teacher: { select: { fullName: true } },
    priceCurrency: { select: { code: true, label: true } },
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
 * exactly one query below, the one that has already proved every gate — so the map of a
 * course is the same shape whether or not any room on it happens to be unlocked. Which rooms
 * unlock for a given reader is a flag on the row, not a second map: see `holdsPlace`. */
const SYLLABUS_INCLUDE = (lessonStatusValueId: string) =>
  ({
    level: { select: { code: true, label: true } },
    teacher: { select: { fullName: true } },
    priceCurrency: { select: { code: true, label: true } },
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

/** One page a student may open, and the two places it hangs from. `isFreePreview` is
 * selected rather than assumed, because the row it describes can have opened for either
 * reason and the caller is owed the difference. */
const READABLE_LESSON_SELECT = {
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

export type ReadableLessonRow = Prisma.LessonGetPayload<{
  select: typeof READABLE_LESSON_SELECT;
}>;

/** What the route that plays a recording needs from it: what the bytes are, how long they are,
 * and the key that stays behind the door. The name travels too, because the page that carries the
 * file says what it is called — the two reads want the same row, and a lesson keeps exactly one
 * standing, so the rule about which one is written once. */
const STANDING_VIDEO_SELECT = {
  displayName: true,
  contentType: true,
  bytes: true,
  storedKey: true,
} as const satisfies Prisma.LessonAssetSelect;

export type StandingVideoRow = Prisma.LessonAssetGetPayload<{
  select: typeof STANDING_VIDEO_SELECT;
}>;

/** A course as a browser addressed it: the id the API issued, or the slug its author chose.
 * Both name one row, so the two must never answer differently. */
export type CatalogCourseRef = { id: string } | { slug: string };

export interface CatalogFilters {
  /** The `published` course status, resolved at the service edge. */
  courseStatusValueId: string;
  /** The `draft` course status, which the shelf never lists and a place alone can open. */
  draftCourseStatusValueId: string;
  lessonStatusValueId: string;
  levelValueId: string | null;
  search: string | null;
}

export interface CatalogPage {
  courses: CourseCardRow[];
  total: number;
}

/**
 * The outer gate, in the two shapes it is needed in.
 *
 * A stranger sees the shelf and nothing else: published, live, and no other answer distinguishes a
 * draft from a typo. A student who holds a place is not a stranger, and a course their teacher took
 * back to a draft does not retract what they took a place in — so for them a draft they belong to
 * opens the same door, and a paused term can be edited without the cohort noticing.
 *
 * An archive is the exception, and the branch is written against `draft` rather than as "not
 * published" so the exception cannot be forgotten by whoever adds a fourth status later. Filing a
 * run away is the teacher withdrawing the teaching, to the people inside it as much as the ones
 * outside — the contract the enrollment suite already holds — while a draft is a term between terms,
 * with its pages still meant to be finished.
 *
 * The place is a branch of this `where` and not a check after it for the reason every gate here is
 * written inside the query: an author who forgot the second half of a two-part rule gets a hole
 * rather than a compile error. What the branch cannot do is widen the shelf — `page` above keeps
 * its published-only statement, so a course that came off the shelf stays off every stranger's list
 * while the students holding places can still open it.
 */
function shelfOrPlace(
  ref: CatalogCourseRef,
  filters: CatalogFilters,
  viewerUserId?: string,
): Prisma.CourseWhereInput {
  const standing = { ...ref, isActive: true };
  if (!viewerUserId) {
    return { ...standing, statusValueId: filters.courseStatusValueId };
  }
  return {
    ...standing,
    OR: [
      { statusValueId: filters.courseStatusValueId },
      {
        statusValueId: filters.draftCourseStatusValueId,
        enrollments: { some: { studentUserId: viewerUserId, isActive: true } },
      },
    ],
  };
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
  async page(filters: CatalogFilters, skip: number, take: number): Promise<CatalogPage> {
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

  /** A course one reader may open: on the shelf, or paused as a draft they hold a place in. An
   * archive opens for nobody.
   *
   * A stranger meets the shelf exactly as before — a draft, an archive and a typo are the same
   * answer, which is the point of a catalog that cannot be walked with a list. A student who took a
   * place is not a stranger: their course coming back off the shelf changes who else can join it,
   * not what they already have, so a paused term is still theirs to finish. */
  async findForReader(ref: CatalogCourseRef, filters: CatalogFilters, viewerUserId?: string) {
    const course = await this.prisma.course.findFirst({
      where: shelfOrPlace(ref, filters, viewerUserId),
      include: SYLLABUS_INCLUDE(filters.lessonStatusValueId),
    });
    return course;
  }

  /**
   * Whether this reader holds a place in a course they are already looking at.
   *
   * The same fact `shelfOrPlace` puts in a `where`, asked a second time because it answers two
   * different questions: there it decides whether a course leaves the database at all, here it
   * colours `isReadable` on each row of the outline that did. The page route keeps its copy inside
   * its own query for the reason it always did — a `body` is the thing at stake — while the outline
   * needs the per-row flag, and no row can be marked readable in a course the gate refused.
   */
  async holdsPlace(courseId: string, studentUserId: string) {
    const place = await this.prisma.enrollment.findFirst({
      where: { courseId, studentUserId, isActive: true },
      select: { id: true },
    });
    return place !== null;
  }

  /**
   * One page, with its body — the only query in this app that hands text over.
   *
   * Every gate is in this single query rather than compared after the fact: the row must be
   * published and live, its module live, and its course open to this reader — on the shelf, or
   * paused as a draft they hold a place in. On top of those, one of two doors has to be open —
   * the teacher marked the page free, or the caller holds a place in the course. A page that fails
   * any of them returns nothing at all, which is what lets the service give the same 404 for
   * "locked", "draft", "not yours to show" and "never written".
   *
   * The door is part of the `where` and not a check in the handler for the same reason the
   * course gate is: a route that honoured the enrollment and forgot the rest of the wall would be
   * reading a teacher's unfinished work to a student who happened to be early. A place-holder's own
   * paused course is the one exception the wall makes, and it is the same exception `findForReader`
   * makes, so a page and the outline it sits in can never disagree about who this reader is.
   */
  async findReadable(
    ref: CatalogCourseRef,
    lessonId: string,
    filters: CatalogFilters,
    viewerUserId?: string,
  ) {
    const openTo = viewerUserId
      ? {
          OR: [
            { isFreePreview: true },
            {
              module: {
                course: {
                  enrollments: { some: { studentUserId: viewerUserId, isActive: true } },
                },
              },
            },
          ],
        }
      : { isFreePreview: true };

    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isActive: true,
        statusValueId: filters.lessonStatusValueId,
        module: {
          isActive: true,
          course: shelfOrPlace(ref, filters, viewerUserId),
        },
        ...openTo,
      },
      select: READABLE_LESSON_SELECT,
    });
    return lesson;
  }

  /**
   * The recording a page carries, asked for after the page was proved readable.
   *
   * A second query rather than an include on the gate above, because the two answer different
   * questions and only one of them is a door: `findReadable` decides whether this caller may see
   * the page at all, and nothing about a recording can change that answer. It also keeps the key
   * out of the read that a browser can reach without a session — a page's text and a page's file
   * are the same permission, but they do not have to be the same query.
   *
   * The newest standing row, which is the rule the teacher's own asset read uses too: a lesson
   * keeps the takes it retired and plays exactly one of them.
   */
  async standingVideo(lessonId: string) {
    return this.prisma.lessonAsset.findFirst({
      where: { lessonId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: STANDING_VIDEO_SELECT,
    });
  }
}
