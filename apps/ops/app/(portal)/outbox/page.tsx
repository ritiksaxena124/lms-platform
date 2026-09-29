import type { Metadata } from 'next';
import { PageHeader, RouteTransition } from '@lms/ui';

import { OutboxTable } from '@/components/outbox-table';

export const metadata: Metadata = {
  title: 'Notification queue',
  description:
    'Every letter the platform filed to send, the state it reached, and why a retry stopped.',
};

/**
 * The queue screen: Phase 6's outbox with a reader at last.
 *
 * The question it answers is the one a person asks an operator — "did my confirmation arrive?" — and
 * the answer is a state, a count of tries and one transport code. Nothing here can be acted on: the
 * sweep owns the row until it reaches a terminal state, and a screen that resent a letter would
 * duplicate a mail host's work from the wrong side of it.
 */
export default function OutboxPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Notification queue"
        description="What the platform decided to tell somebody, whether it got told, and what stopped it if it did not."
        meta="Read-only · the letter itself never leaves the row, and neither does an address"
      />
      <div className="mt-8">
        <OutboxTable />
      </div>
    </RouteTransition>
  );
}
