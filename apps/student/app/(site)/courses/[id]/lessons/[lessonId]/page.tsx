import { RouteTransition } from '@lms/ui';

import { CourseLesson } from '@/components/course-lesson';

export const metadata = { title: 'Course lesson' };

/**
 * The one page of a course a stranger may open, addressed as the pair it belongs to.
 *
 * Nothing here is looked up ahead of the request: the component asks the catalog for the pair
 * and shows whatever comes back, because the answer a locked row gets is the answer a missing
 * one gets, and a server render that tried to tell them apart first would be the leak.
 */
export default async function CourseLessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const { id, lessonId } = await params;

  return (
    <RouteTransition>
      <CourseLesson courseId={id} lessonId={lessonId} />
    </RouteTransition>
  );
}
