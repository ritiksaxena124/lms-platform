import type { Course, CourseChoice, CourseDraftInput, CourseEditInput } from '@lms/shared';

import { apiJson } from './api';

/**
 * The course calls the portal makes, one function per API route.
 *
 * Nothing here decides what a course is: the types come from `@lms/shared`, so a field the
 * API renames is a compile error in the portal rather than a form that quietly stops
 * sending it.
 */

/**
 * Fields the person never filled are not sent — but an empty string is, because that is
 * what "I deleted my summary" looks like from a form. Dropping it would leave the old text
 * in place while the teacher watched the box go empty.
 */
function withoutAbsent<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

export async function listCourses(): Promise<Course[]> {
  const { items } = await apiJson<{ items: Course[] }>('/courses');
  return items;
}

export async function courseLevels(): Promise<CourseChoice[]> {
  const { items } = await apiJson<{ items: CourseChoice[] }>('/courses/levels');
  return items;
}

/** One course, by id — a teacher arriving at an edit link from anywhere but the list. */
export async function readCourse(id: string): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>(`/courses/${id}`);
  return course;
}

export async function createCourse(input: CourseDraftInput): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>('/courses', {
    method: 'POST',
    body: withoutAbsent(input),
  });
  return course;
}

export async function updateCourse(id: string, input: CourseEditInput): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>(`/courses/${id}`, {
    method: 'PATCH',
    body: withoutAbsent(input),
  });
  return course;
}

/**
 * A transition, not a field write. The API checks the precondition — whether a summary and
 * a description exist yet, whether the course is a draft — so the portal asks for the move
 * by name and shows whatever it says back.
 */
export async function publishCourse(id: string): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>(`/courses/${id}/publish`, {
    method: 'POST',
  });
  return course;
}

export async function archiveCourse(id: string): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>(`/courses/${id}/archive`, {
    method: 'POST',
  });
  return course;
}
