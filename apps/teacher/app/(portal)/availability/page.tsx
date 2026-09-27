import { PageHeader, RouteTransition } from '@lms/ui';

import { AvailabilityWeek } from '@/components/availability-week';

export const metadata = { title: 'Availability' };

export default function AvailabilityPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Availability"
        description="The windows you keep open each week. A student books a class out of one of these, in your timezone rather than theirs."
      />
      <div className="mt-6 max-w-4xl">
        <AvailabilityWeek />
      </div>
    </RouteTransition>
  );
}
