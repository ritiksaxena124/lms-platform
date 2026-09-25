import { PageHeader, RouteTransition } from '@lms/ui';

import { CourseEditor } from '@/components/course-editor';

export const metadata = { title: 'Course' };

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Course"
        description="Everything a student reads about this course, in one form."
        breadcrumbs={[{ label: 'Courses', href: '/courses' }, { label: 'Edit' }]}
      />
      <div className="mt-6 max-w-2xl">
        <CourseEditor courseId={id} />
      </div>
    </RouteTransition>
  );
}
