import { PageHeader, RouteTransition } from '@lms/ui';

import { CohortCalendar } from '@/components/cohort-calendar';

export const metadata = { title: 'Calendar' };

export default function CalendarPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Calendar"
        description="The classes your series writes — dated, a month ahead, with the days you marked off left empty. Nothing here is edited: a class changes when the plan behind it does."
      />
      <div className="mt-6">
        <CohortCalendar />
      </div>
    </RouteTransition>
  );
}
