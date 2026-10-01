import { PageHeader, RouteTransition } from '@lms/ui';

import { CourseNav } from '@/components/course-nav';
import { CourseRoster } from '@/components/course-roster';

export const metadata = { title: 'Roster' };

export default async function CourseRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Roster"
        description="The students holding a place in this course, and the day each one took it."
        breadcrumbs={[
          { label: 'Courses', href: '/courses' },
          { label: 'Course', href: `/courses/${id}/edit` },
          { label: 'Roster' },
        ]}
      />
      <CourseNav courseId={id} active="roster" />
      <div className="mt-6 max-w-3xl">
        <CourseRoster courseId={id} />
      </div>
    </RouteTransition>
  );
}
