import { PageHeader, RouteTransition } from '@lms/ui';

import { CourseEditor } from '@/components/course-editor';

export const metadata = { title: 'New course' };

export default function NewCoursePage() {
  return (
    <RouteTransition>
      <PageHeader
        title="New course"
        description="A title and a level are enough to start. The rest can be written in passes — nothing is shared until you publish it."
        breadcrumbs={[{ label: 'Courses', href: '/courses' }, { label: 'New' }]}
      />
      <div className="mt-6 max-w-2xl">
        <CourseEditor />
      </div>
    </RouteTransition>
  );
}
