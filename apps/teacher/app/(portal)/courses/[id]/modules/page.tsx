import { PageHeader, RouteTransition } from '@lms/ui';

import { CourseNav } from '@/components/course-nav';
import { CourseSyllabus } from '@/components/course-syllabus';

export const metadata = { title: 'Syllabus' };

export default async function CourseModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Syllabus"
        description="The blocks this course teaches, in the order it teaches them."
        breadcrumbs={[
          { label: 'Courses', href: '/courses' },
          { label: 'Course', href: `/courses/${id}/edit` },
          { label: 'Syllabus' },
        ]}
      />
      <CourseNav courseId={id} active="syllabus" />
      <div className="mt-6 max-w-3xl">
        <CourseSyllabus courseId={id} />
      </div>
    </RouteTransition>
  );
}
