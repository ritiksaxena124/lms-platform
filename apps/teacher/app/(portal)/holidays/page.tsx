import { PageHeader, RouteTransition } from '@lms/ui';

import { HolidayManager } from '@/components/holiday-manager';

export const metadata = { title: 'Holidays' };

export default function HolidaysPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Holidays"
        description="Days you don't teach — festivals, personal days off, or recurring annual observances. A marked-off day takes that date's classes off your calendar, and lifting it puts them back. It closes the booking grid for that day too: students are not offered a minute you are away for."
      />
      <div className="mt-6 max-w-xl">
        <HolidayManager />
      </div>
    </RouteTransition>
  );
}
