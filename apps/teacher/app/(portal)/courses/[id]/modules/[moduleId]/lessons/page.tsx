import { PageHeader, RouteTransition } from '@lms/ui';

import { CourseNav } from '@/components/course-nav';
import { ModuleLessons } from '@/components/module-lessons';

export const metadata = { title: 'Lessons' };

export default async function ModuleLessonsPage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Lessons"
        description="The pages inside this block — what a student reads, in the order they read it."
        breadcrumbs={[
          { label: 'Courses', href: '/courses' },
          { label: 'Course', href: `/courses/${id}/edit` },
          { label: 'Syllabus', href: `/courses/${id}/modules` },
          { label: 'Lessons' },
        ]}
      />
      <CourseNav courseId={id} active="lessons" />
      <div className="mt-6 max-w-3xl">
        <ModuleLessons courseId={id} moduleId={moduleId} />
      </div>
    </RouteTransition>
  );
}
