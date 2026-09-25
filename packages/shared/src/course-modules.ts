/**
 * The syllabus wire contract: one ordered block inside a course.
 *
 * There is no `position` in an input, in either direction. Order is the API's to assign —
 * a client allowed to name a slot could put two modules in it, and a drag-and-drop portal
 * would be keeping the arithmetic that the unique index exists to do. What a writer sends
 * is a title and optionally two paragraphs; what comes back is where it landed.
 */

export interface CourseModule {
  id: string;
  courseId: string;
  title: string;
  summary: string | null;
  description: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CourseModuleResponse {
  module: CourseModule;
}

export interface CourseModuleListResponse {
  items: CourseModule[];
}

export interface CreateCourseModuleInput {
  title: string;
  summary?: string;
  description?: string;
}

/** Absent means unchanged, not cleared — the same promise the course editor makes. */
export type UpdateCourseModuleInput = Partial<CreateCourseModuleInput>;

/** Every module a course currently shows, in the new order, and nothing else. */
export interface ReorderCourseModulesInput {
  moduleIds: string[];
}
