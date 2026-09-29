import { Card, CardHeader, Illo, PageHeader, RouteTransition, Stagger, StatusPill } from '@lms/ui';

/**
 * The desk before its screens.
 *
 * Three cards, no links: the read routes behind them already answer on the API (7d's ledger, 8a's
 * accounts, 8b's queue) and the portals that show them arrive next. A link that goes to a page this
 * repo has not written yet is worse than a card that says so, because an operator would click it in
 * good faith and land on a 404 in a tool meant for incidents.
 */
export default function OpsDeskPage() {
  return (
    <RouteTransition>
      <PageHeader
        title="Ops desk"
        description="Everything this platform recorded about itself, in one read-only place."
        meta="Phase 8 · the accounts and the queue are answered by the API; the screens are next"
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
