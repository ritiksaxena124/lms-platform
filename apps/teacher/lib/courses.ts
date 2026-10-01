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
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

export async function listCourses(): Promise<Course[]> {
  const { items } = await apiJson<{ items: Course[] }>('/courses');
  return items;
}

export async function courseLevels(): Promise<CourseChoice[]> {
  const { items } = await apiJson<{ items: CourseChoice[] }>('/courses/levels');
  return items;
}

/** The currencies a price can be quoted in. Its own route rather than a reuse of the level
 * list, because the two pickers ask about two lookups — and a form that offered
 * `beginner` as a unit of money would be a bug the API has already refused. */
export async function courseCurrencies(): Promise<CourseChoice[]> {
  const { items } = await apiJson<{ items: CourseChoice[] }>('/courses/currencies');
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

/**
 * The two moves back, each named for the shelf it leaves rather than the state it lands on.
 *
 * Both land on `draft`, and the portal does not say so in a request: which state a course comes
 * back to is the API's rule, and a body that carried one would be a second copy of it. Asking by
 * verb also keeps the refusal where it belongs — a draft cannot be unpublished, and the answer
 * that says so comes from the same route the success comes from.
 */
export async function unpublishCourse(id: string): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>(`/courses/${id}/unpublish`, {
    method: 'POST',
  });
  return course;
}

export async function unarchiveCourse(id: string): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>(`/courses/${id}/unarchive`, {
    method: 'POST',
  });
  return course;
}

/**
 * The trial-call switch, on a route of its own rather than as a field of the edit form.
 *
 * The form closes when a course is published, and this is the one decision a teacher keeps
 * revisiting about a course that is already live — so the API takes it as its own write, with the
 * word in the body and the whole course back in the answer. Opening and closing are the same call.
 */
export async function setDemoBookings(id: string, enabled: boolean): Promise<Course> {
  const { course } = await apiJson<{ course: Course }>(`/courses/${id}/demo-bookings`, {
    method: 'POST',
    body: { enabled },
  });
  return course;
}
