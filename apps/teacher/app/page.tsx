import { Card, CardHeader, Illo, PageHeader, RouteTransition, Stagger, StatusPill } from '@lms/ui';

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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-6 rounded-card border border-brand-line bg-brand-wash px-6 py-6">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-brand-deep">First things first</p>
          <h2 className="mt-1 text-h2 text-ink-strong">Publish a course to open your calendar</h2>
          <p className="mt-1 max-w-[52ch] text-[0.9375rem] text-ink-muted">
            Until a course exists, students have nothing to request and this page stays as calm as
            it is now.
          </p>
        </div>
        <Illo src="/illustrations/peep-standing-03.svg" size="md" className="hidden sm:block" />
      </div>
    </RouteTransition>
  );
}
