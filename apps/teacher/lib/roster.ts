import type { CourseRosterResponse } from '@lms/shared';

import { apiJson } from './api';

/**
 * The teacher's read of who holds a place in one of their courses.
 *
 * One function, because there is one route, and the portal has no way to act on a row: leaving
 * is the student's decision (§12), so a roster screen that could remove somebody would be a
 * client feature the API refuses to back.
 */
export async function courseRoster(courseId: string, page = 1): Promise<CourseRosterResponse> {
  const query = page > 1 ? `?page=${encodeURIComponent(String(page))}` : '';
  return apiJson<CourseRosterResponse>(`/courses/${encodeURIComponent(courseId)}/roster${query}`);
}
