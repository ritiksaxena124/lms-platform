import { PageHeader, RouteTransition } from '@lms/ui';

import { HolidayManager } from '@/components/holiday-manager';

export const metadata = { title: 'Holidays' };

export default function HolidaysPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Holidays"
        description="Days you don't teach — festivals, personal days off, or recurring annual observances. These block all slot generation on the specified dates."
      />
      <div className="mt-6 max-w-xl">
        <HolidayManager />
      </div>
    </RouteTransition>
  );
}
