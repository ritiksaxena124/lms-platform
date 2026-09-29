import type { Metadata } from 'next';
import { PageHeader, RouteTransition } from '@lms/ui';

import { ActivityLog } from '@/components/activity-log';

export const metadata: Metadata = {
  title: 'Activity log',
  description: 'Every change this platform recorded, newest first.',
};

/**
 * The ledger screen, and the reason the ops role exists.
 *
 * Nothing here explains the rows beyond what they carry: no link to the course a `course_published`
 * was about, because `target_id` has no foreign key by design (7a) and a link that 404s on an archived
 * row would read as a bug in the desk rather than as the record doing its job.
 */
export default function ActivityPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Activity log"
        description="Every write that changed a standing row, with the name or the scheduler that did it."
        meta="Append-only · the log is written beside the write that earned it, never edited from here"
      />
      <div className="mt-8">
        <ActivityLog />
      </div>
    </RouteTransition>
  );
}
