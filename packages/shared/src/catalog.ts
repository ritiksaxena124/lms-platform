/**
 * The catalog wire contract: a course as a stranger reads it, before they are anybody's
 * enrolled learner.
 *
 * Two absences define this shape. There is no `status` — a course that is not published is
 * not in the catalog at all, so a field that could only ever hold one value would be a
 * question nobody can ask. And there is no lesson `body` anywhere: a card says how many
 * pages there are and the detail says what they are called and roughly how long each costs,
 * which is enough for a person to decide. Reading one is what enrollment will be for.
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

/** A page a student may read, named but not opened. */
export interface CatalogLesson {
  id: string;
  title: string;
  position: number;
  estimatedMinutes: number | null;
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
