/**
 * The lesson wire contract: one page inside one module.
 *
 * Two things are missing from every input, on purpose. `position` is the API's to assign —
 * the same argument a module makes, except that the slots are per module here, so "lesson 2"
 * means the second page of a block rather than the second page of a course. And `status` is
 * not a field a form can write: a lesson moves between draft and published through
 * `publish` and `unpublish`, because that is where the promise a student relies on is
 * checked — a page with nothing in it cannot be published however the form was built.
 */

/** A reference row as it travels: the code for machines, the label so no client keeps a
 * translation table that goes stale when Ops edits one. */
export interface LessonChoice {
  code: string;
  label: string;
}

export interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  /** The page as the teacher wrote it. Markdown is stored unsentenced and rendered by
   * whichever client shows it; the API only ever promises the characters. */
  body: string | null;
  estimatedMinutes: number | null;
  /** The teacher's "read this one without enrolling". It is a flag on the page, not a door:
   * the catalog only honours it on a published lesson inside a published course, so a draft
   * can carry the intention without leaking anything. */
  isFreePreview: boolean;
  position: number;
  status: LessonChoice;
  createdAt: string;
  updatedAt: string;
}

export interface LessonResponse {
  lesson: Lesson;
}

export interface LessonListResponse {
  items: Lesson[];
}

export interface CreateLessonInput {
  title: string;
  body?: string;
  estimatedMinutes?: number | null;
}

/**
 * Absent means unchanged, not cleared — and `moduleId` here is a move, which is the one
 * edit that also changes the lesson's position, because it lands at the end of the module
 * it arrives in rather than keeping a slot in a block it has left.
 */
export interface UpdateLessonInput {
  title?: string;
  body?: string | null;
  estimatedMinutes?: number | null;
  moduleId?: string;
}

/** Every lesson a module currently shows, in the new order, and nothing else. */
export interface ReorderLessonsInput {
  lessonIds: string[];
}
