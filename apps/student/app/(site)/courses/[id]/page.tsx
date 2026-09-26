import { RouteTransition } from '@lms/ui';

import { CourseOutline } from '@/components/course-outline';

export const metadata = { title: 'Course' };

/**
 * The address a card on the shelf links to, keyed by the course's id.
 *
 * A slug would read better in an address, and the catalog does send one — but the read route
 * is addressed by id, because that is what never changes when a teacher retitles their course.
 * A slug lookup is an API decision first, so it belongs to that step rather than being faked
 * here by a second fetch.
 */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <CourseOutline courseId={id} />
    </RouteTransition>
  );
}
