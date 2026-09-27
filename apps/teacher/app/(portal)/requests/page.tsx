import { PageHeader, RouteTransition } from '@lms/ui';

import { RequestInbox } from '@/components/request-inbox';

export const metadata = { title: 'Requests' };

export default function RequestsPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Requests"
        description="Students waiting for you to confirm a class. A request that goes unanswered expires on its own, so nothing sits here forever."
      />
      <div className="mt-6 max-w-3xl">
        <RequestInbox />
      </div>
    </RouteTransition>
  );
}
