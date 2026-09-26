import { RouteTransition } from '@lms/ui';

import { CourseOutline } from '@/components/course-outline';

export const metadata = { title: 'Course' };

/**
 * The address a card on the shelf links to, keyed by the course's id.
 *
 * The catalog will also read a course by its slug, so a pasted link from somewhere else lands
 * here unchanged — this page passes the segment through without deciding what kind it is. The
 * portal's own links use the id, because that is the field that cannot move when a teacher
 * retitles a course.
 */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <CourseOutline courseId={id} />
    </RouteTransition>
  );
}
