import type {
  CreateLessonInput,
  Lesson,
  ReorderLessonsInput,
  UpdateLessonInput,
} from '@lms/shared';

import { apiJson } from './api';

/**
 * The lesson calls the portal makes, one function per API route.
 *
 * As with the syllabus, nothing here computes an order: `position` never appears in a body,
 * a create is answered with the slot the API chose, and a reorder sends the whole list and
 * repaints from the reply. `status` is absent too — a lesson reaches published through
 * `publishLesson`, which is where the API can check that the page has anything in it.
 */

/** Fields the person never filled are not sent — an empty string is, because that is what
 * "I deleted this paragraph" looks like from a form. */
function withoutAbsent<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

export async function listLessons(moduleId: string): Promise<Lesson[]> {
  const { items } = await apiJson<{ items: Lesson[] }>(`/modules/${moduleId}/lessons`);
  return items;
}

export async function createLesson(
  moduleId: string,
  input: CreateLessonInput,
): Promise<Lesson> {
  const { lesson: created } = await apiJson<{ lesson: Lesson }>(`/modules/${moduleId}/lessons`, {
    method: 'POST',
    body: withoutAbsent(input),
  });
  return created;
}

/** An edit that names a `moduleId` is a move, and the reply carries the slot it landed in. */
export async function updateLesson(
  moduleId: string,
  id: string,
  input: UpdateLessonInput,
): Promise<Lesson> {
  const { lesson: updated } = await apiJson<{ lesson: Lesson }>(
    `/modules/${moduleId}/lessons/${id}`,
    { method: 'PATCH', body: withoutAbsent(input) },
  );
  return updated;
}

/** The new order, every lesson of this module named once. The API answers with the module. */
export async function reorderLessons(moduleId: string, lessonIds: string[]): Promise<Lesson[]> {
  const body: ReorderLessonsInput = { lessonIds };
  const { items } = await apiJson<{ items: Lesson[] }>(`/modules/${moduleId}/lessons/reorder`, {
    method: 'POST',
    body,
  });
  return items;
}

/** The one transition with a precondition the form cannot see: an empty page will not publish. */
export async function publishLesson(moduleId: string, id: string): Promise<Lesson> {
  const { lesson: published } = await apiJson<{ lesson: Lesson }>(
    `/modules/${moduleId}/lessons/${id}/publish`,
    { method: 'POST' },
  );
  return published;
}

export async function unpublishLesson(moduleId: string, id: string): Promise<Lesson> {
  const { lesson: draft } = await apiJson<{ lesson: Lesson }>(
    `/modules/${moduleId}/lessons/${id}/unpublish`,
    { method: 'POST' },
  );
  return draft;
}

export async function deactivateLesson(moduleId: string, id: string): Promise<Lesson> {
  const { lesson: gone } = await apiJson<{ lesson: Lesson }>(
    `/modules/${moduleId}/lessons/${id}/deactivate`,
    { method: 'POST' },
  );
  return gone;
}
