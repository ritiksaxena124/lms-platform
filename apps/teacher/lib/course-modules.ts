import type {
  CourseModule,
  CreateCourseModuleInput,
  ReorderCourseModulesInput,
  UpdateCourseModuleInput,
} from '@lms/shared';

import { apiJson } from './api';

/**
 * The syllabus calls the portal makes, one function per API route.
 *
 * Nothing here computes an order. `position` never appears in a body: a create is answered
 * by the API with the slot it chose, and a reorder sends the whole list of ids and repaints
 * from what comes back, so the screen can never disagree with the row it wrote.
 */

/** Fields the person never filled are not sent — an empty string is, because that is what
 * "I deleted this paragraph" looks like from a form. */
function withoutAbsent<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

export async function listModules(courseId: string): Promise<CourseModule[]> {
  const { items } = await apiJson<{ items: CourseModule[] }>(`/courses/${courseId}/modules`);
  return items;
}

export async function createModule(
  courseId: string,
  input: CreateCourseModuleInput,
): Promise<CourseModule> {
  const { module: created } = await apiJson<{ module: CourseModule }>(
    `/courses/${courseId}/modules`,
    { method: 'POST', body: withoutAbsent(input) },
  );
  return created;
}

export async function updateModule(
  courseId: string,
  id: string,
  input: UpdateCourseModuleInput,
): Promise<CourseModule> {
  const { module: updated } = await apiJson<{ module: CourseModule }>(
    `/courses/${courseId}/modules/${id}`,
    { method: 'PATCH', body: withoutAbsent(input) },
  );
  return updated;
}

/** The new order, every module named once. The API answers with the whole syllabus. */
export async function reorderModules(
  courseId: string,
  moduleIds: string[],
): Promise<CourseModule[]> {
  const body: ReorderCourseModulesInput = { moduleIds };
  const { items } = await apiJson<{ items: CourseModule[] }>(
    `/courses/${courseId}/modules/reorder`,
    { method: 'POST', body },
  );
  return items;
}

/** A transition with no body: removal is decided by the course's status, not by a field. */
export async function deactivateModule(courseId: string, id: string): Promise<CourseModule> {
  const { module: gone } = await apiJson<{ module: CourseModule }>(
    `/courses/${courseId}/modules/${id}/deactivate`,
    { method: 'POST' },
  );
  return gone;
}
