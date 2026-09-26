/**
 * The catalog wire contract: a course as a stranger reads it, before they are anybody's
 * enrolled learner.
 *
 * Two absences define this shape. There is no `status` — a course that is not published is
 * not in the catalog at all, so a field that could only ever hold one value would be a
 * question nobody can ask. And the syllabus carries no lesson `body`: a card says how many
 * pages there are and the detail says what they are called and roughly how long each costs,
 * which is enough for a person to decide. Opening one is what enrollment is for, with one
 * exception — the page a teacher deliberately left the door open on. Both cases are the same
 * endpoint below, and neither is a syllabus row with a body slipped in.
 *
 * The counts are gated counts. A module is counted while it is still in the syllabus, and a
 * lesson only once both of its gates are open — the page published and the course around it
 * published too — so the number on a card is the number of pages the detail will actually
 * list. A card that promised nine and opened onto four would teach a student to distrust it.
 */
import type { CourseChoice } from './courses';

/** Who wrote the course, as little of them as a browsing student needs. */
export interface CatalogTeacher {
  displayName: string;
}

/** One course, as it sits in a list. */
export interface CatalogCourse {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  level: CourseChoice;
  teacher: CatalogTeacher;
  moduleCount: number;
  lessonCount: number;
  updatedAt: string;
}

/** A page a student may read, named but not opened. `isFreePreview` says which rows the
 * endpoint below opens for somebody with no place in the course; a student who holds one
 * reads every published page of it either way. */
export interface CatalogLesson {
  id: string;
  title: string;
  position: number;
  estimatedMinutes: number | null;
  isFreePreview: boolean;
}

export interface CatalogModule {
  id: string;
  title: string;
  summary: string | null;
  position: number;
  lessons: CatalogLesson[];
}

/** One course as its own page: the card's fields plus the description and the syllabus. The
 * counts a card carries are not repeated here — the syllabus is on the page, so a client
 * that wanted a number could count it. */
export interface CatalogCourseDetail {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  level: CourseChoice;
  teacher: CatalogTeacher;
  modules: CatalogModule[];
  createdAt: string;
  updatedAt: string;
}

export interface CatalogCourseResponse {
  course: CatalogCourseDetail;
}

/** The two places a free page hangs from, sent with it because a reader who arrived here
 * from a link has no syllabus on screen and needs both to go back. */
export interface CatalogLessonModule {
  id: string;
  title: string;
  position: number;
}

export interface CatalogLessonCourse {
  id: string;
  slug: string;
  title: string;
}

/** One page of a published course, opened. Two things let that happen: the teacher marked
 * it free to read, or the caller holds a place in the course. `isFreePreview` says which —
 * and it is `false` for a page that opened because of who asked, because the flag is the
 * teacher's statement about the page, not a description of why the reader got in. */
export interface CatalogLessonPage {
  id: string;
  title: string;
  body: string | null;
  estimatedMinutes: number | null;
  position: number;
  isFreePreview: boolean;
  updatedAt: string;
  module: CatalogLessonModule;
  course: CatalogLessonCourse;
}

export interface CatalogLessonResponse {
  lesson: CatalogLessonPage;
}

export interface CatalogCourseListResponse {
  items: CatalogCourse[];
  page: number;
  pageSize: number;
  total: number;
}

/** What a browsing student may ask for: a level, a phrase, and which page of results. */
export interface CatalogListInput {
  level?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}
