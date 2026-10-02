import { PageHeader, RouteTransition } from '@lms/ui';

import { CourseNav } from '@/components/course-nav';
import { SeriesManager } from '@/components/series-manager';

export const metadata = { title: 'Class Series' };

export default async function CourseSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Class Series"
        description="The weekly slot this course keeps meeting at, written down until you retire it. Saving one writes the classes it stands for onto your calendar, a month ahead; retiring it closes the ones still to come."
        breadcrumbs={[
          { label: 'Courses', href: '/courses' },
          { label: 'Course', href: `/courses/${id}/edit` },
          { label: 'Series' },
        ]}
      />
      <CourseNav courseId={id} active="series" />
      <div className="mt-6 max-w-xl">
        <SeriesManager courseId={id} />
      </div>
    </RouteTransition>
  );
}
