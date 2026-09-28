import type {
  CatalogCourseDetail,
  CatalogCourseListResponse,
  CatalogLessonPage,
  CatalogListInput,
  CourseChoice,
} from '@lms/shared';

import { apiBytes, apiGet } from './api';

/**
 * The five catalog calls — one per route the API opens to a reader.
 *
 * Nothing here decides what a course is: the types come from `@lms/shared`, so a field the
 * API renames is a compile error in this portal rather than a card that quietly stops
 * showing it.
 *
 * Which calls send the session is the API's own split, stated in `lib/api.ts`: the shelf and
 * the level list are the same list for every visitor, while a course's outline and one of its
 * pages answer a question about the caller. A read that withheld the session would answer a
 * member as a stranger — and a shelf that carried it would be a cached page pointing at the
 * wrong person. `lib/enrollments.ts` holds the three calls that speak of places.
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
    '',
    { withSession: true },
  );
  return course;
}

/**
 * One page of a course, with its text.
 *
 * Both halves of the address go up, because a page only exists inside the syllabus that lists
 * it — and a locked row, a withdrawn one and one nobody wrote all answer the same 404, which
 * is the distinction this portal is not allowed to invent.
 *
 * The route opens for two reasons: a door the teacher left open for anybody, or a place this
 * reader holds in the course. Hence the session — without it the second reason cannot be heard.
 */
export async function readLessonPage(
  courseId: string,
  lessonId: string,
): Promise<CatalogLessonPage> {
  const { lesson } = await apiGet<{ lesson: CatalogLessonPage }>(
    `/catalog/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
    '',
    { withSession: true },
  );
  return lesson;
}

/**
 * The recording on a page, as bytes.
 *
 * The address is built here from the page's two ids and never from anything the file says about
 * itself, because there is nothing to build it from: a recording on this platform has no URL. The
 * page names the file and its length, and this route is the only way to its bytes — which is what
 * keeps one door in front of both the text and the video, so a link cannot be shared, bookmarked
 * or cached past the enrollment that opened it.
 *
 * The whole file arrives in one Blob rather than as a stream. A player that is handed an object
 * URL can seek anywhere in the recording without another request, and the alternative — proxying
 * each range the scrubber asks for through a sessioned call — is a second transport to get wrong.
 */
export async function lessonVideoBytes(courseId: string, lessonId: string): Promise<Blob> {
  return apiBytes(
    `/catalog/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/video`,
  );
}
