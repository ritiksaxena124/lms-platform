import Link from 'next/link';
import {
  buttonClass,
  Card,
  CardHeader,
  cn,
  Illo,
  PageHeader,
  RouteTransition,
  Stagger,
  StatusPill,
} from '@lms/ui';

/**
 * The desk and the three questions it is for.
 *
 * A card links only when its screen exists. The accounts and the queue are answered by the API
 * (8a, 8b) and their screens arrive beside them, and a link to a page this repo has not written is
 * worse than a card that says so: an operator clicks it in good faith and lands on a 404 in a tool
 * meant for incidents.
 */
export default function OpsDeskPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Ops desk"
        description="Everything this platform recorded about itself, in one read-only place."
        meta="Phase 8 · the ledger is open; the accounts and the queue screens follow it"
        actions={
          <StatusPill tone="ember" pulse>
            Being built
          </StatusPill>
        }
      />

      <Stagger className="mt-8 grid gap-4 md:grid-cols-3" startIndex={1}>
        <Card>
          <CardHeader
            eyebrow="The ledger"
            title="Activity log"
            description="Who wrote what, when, and in whose name — every standing-row change since Phase 7."
          />
          <Link
            href="/activity"
            transitionTypes={['nav-forward']}
            className={cn(buttonClass({ variant: 'secondary', size: 'sm' }), 'mt-4')}
          >
            Read the log
          </Link>
        </Card>
        <Card>
          <CardHeader
            eyebrow="The people"
            title="Accounts"
            description="Find an account by name or role, disable it, and issue or revoke the ops role."
          />
        </Card>
        <Card>
          <CardHeader
            eyebrow="The letters"
            title="Notification queue"
            description="Seven kinds of news, the state each one reached, and the reason a retry stopped."
          />
        </Card>
      </Stagger>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-6 rounded-card border border-brand-line bg-brand-wash px-6 py-6">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-brand-deep">Before you read anything</p>
          <h2 className="mt-1 text-h2 text-ink-strong">
            This desk changes three things, and none of them are content
          </h2>
          <p className="mt-1 max-w-[56ch] text-[0.9375rem] text-ink-muted">
            A course, a class and a price belong to their teachers and students. What lives here is
            an account's status, an account's role, and your own name at the top of whatever you did
            — so the two writes on this portal are the ones the ledger will read back to you.
          </p>
        </div>
        <Illo src="/illustrations/peep-standing-19.svg" size="md" className="hidden sm:block" />
      </div>
    </RouteTransition>
  );
}
