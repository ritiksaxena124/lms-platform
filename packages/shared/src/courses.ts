/**
 * The course wire contract, written once so the API that produces it and the portal that
 * renders it cannot drift apart mid-request. Status and level values are the codes and
 * labels the `CourseStatus` / `CourseLevel` lookup rows carry: a label travels with the
 * code precisely so no client keeps a translation table that goes stale when Ops edits one.
 */

export interface CourseChoice {
  code: string;
  label: string;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  description: string | null;
  level: CourseChoice;
  status: CourseChoice;
  createdAt: string;
  updatedAt: string;
}

export interface CourseResponse {
  course: Course;
}

export interface CourseListResponse {
  items: Course[];
}

/** What a create sends. `status` is absent on purpose — publishing is a transition the
 * API checks, not a field a form can write. */
export interface CourseDraftInput {
  title: string;
  level: string;
  slug?: string;
  summary?: string;
  description?: string;
}

/** What an edit sends: only the fields the person touched, so an untouched one is not
 * rewritten behind their back by a form that loaded a stale copy. */
export type CourseEditInput = Partial<CourseDraftInput>;
