import type {
  CatalogCourseDetail,
  CatalogCourseListResponse,
  CatalogListInput,
  CourseChoice,
} from '@lms/shared';

import { apiGet } from './api';

/**
 * The three calls the student portal makes, one per catalog route.
 *
 * Nothing here decides what a course is: the types come from `@lms/shared`, so a field the
 * API renames is a compile error in this portal rather than a card that quietly stops
 * showing it.
 */

/** What a browsing visitor can ask for. `pageSize` is not among them: twelve is the shelf's
 * rhythm and a query parameter is a public surface, so choosing one is an API decision. */
export type CatalogSearch = Omit<CatalogListInput, 'pageSize'>;

/**
 * Only the filters actually chosen.
 *
 * An empty `q` would be a search for nothing in particular, and a `page=1` on the first page
 * would make every clean URL have a dirty twin. Values are encoded because a visitor typing
 * `&` into the search box means the character, not a second parameter.
 */
function queryString(input: CatalogSearch): string {
  const parts: string[] = [];
  if (input.level) parts.push(`level=${encodeURIComponent(input.level)}`);
  const search = input.q?.trim();
  if (search) parts.push(`q=${encodeURIComponent(search)}`);
  if (input.page && input.page > 1) parts.push(`page=${input.page}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export async function browseCatalog(input: CatalogSearch = {}): Promise<CatalogCourseListResponse> {
  return apiGet<CatalogCourseListResponse>('/catalog/courses', queryString(input));
}

export async function catalogLevels(): Promise<CourseChoice[]> {
  const { items } = await apiGet<{ items: CourseChoice[] }>('/catalog/courses/levels');
  return items;
}

/** One course and its syllabus. A draft, an archived course and an id that was never written
 * all come back as the same 404, which is what the screen shows rather than hides. */
export async function readCatalogCourse(id: string): Promise<CatalogCourseDetail> {
  const { course } = await apiGet<{ course: CatalogCourseDetail }>(
    `/catalog/courses/${encodeURIComponent(id)}`,
  );
  return course;
}
