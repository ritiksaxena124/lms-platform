import { PageHeader, RouteTransition } from '@lms/ui';

import { RollSheet } from '@/components/roll-sheet';

export const metadata = { title: 'Roll' };

export default async function ClassRollPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;

  return (
    <RouteTransition>
      <PageHeader
        title="Roll"
        description="Who stood for this class. Mark the names once it has started — a line nobody marked stays unmarked rather than absent."
        breadcrumbs={[{ label: 'Calendar', href: '/calendar' }, { label: 'Roll' }]}
      />
      <div className="mt-6 max-w-3xl">
        <RollSheet classId={classId} />
      </div>
    </RouteTransition>
  );
}
