import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  RouteTransition,
  Stagger,
  StatusPill,
} from '@lms/ui';

export default function OverviewPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Overview"
        description="Sessions, earnings and student requests — the three things worth opening this portal for."
        meta="Phase 1 shell · live data arrives with accounts in Phase 2"
        actions={
          <StatusPill tone="ember" pulse>
            Setting up
          </StatusPill>
        }
      />

      <Stagger className="mt-8 grid gap-4 md:grid-cols-3" startIndex={1}>
        <Card>
          <CardHeader eyebrow="Next 7 days" title="Sessions" description="Nothing booked yet." />
        </Card>
        <Card>
          <CardHeader eyebrow="This month" title="Earnings" description="No payouts to date." />
        </Card>
        <Card>
          <CardHeader
            eyebrow="Inbox"
            title="Requests"
            description="Students reach you here once profiles are live."
          />
        </Card>
      </Stagger>

      <div className="mt-4">
        <EmptyState
          title="Nothing to act on yet"
          description="This portal is the shell: navigation, tokens and every operation state are wired up. Booking, course and payout data replace these panels from Phase 2 onward."
        />
      </div>
    </RouteTransition>
  );
}
