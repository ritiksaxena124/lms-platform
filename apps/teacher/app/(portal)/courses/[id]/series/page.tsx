import { PageHeader, RouteTransition } from '@lms/ui';

import { SeriesManager } from '@/components/series-manager';

export const metadata = { title: 'Class Series' };

export default async function CourseSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Class Series"
        description="Recurring weekly slots that auto-enroll students. Each series generates instances for enrolled students until you retire it."
        breadcrumbs={[
          { label: 'Courses', href: '/courses' },
          { label: 'Edit', href: `/courses/${id}/edit` },
          { label: 'Series' },
        ]}
      />
      <div className="mt-6 max-w-xl">
        <SeriesManager courseId={id} />
      </div>
    </RouteTransition>
  );
}
