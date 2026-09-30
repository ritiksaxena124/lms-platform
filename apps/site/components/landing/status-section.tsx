import { cn } from '@lms/ui';

/**
 * Transparency section: what works and what doesn't, said honestly. This is
 * one of Hourloom's distinctive traits — it names what is not built yet
 * right on the landing page instead of hiding it.
 */

const SHIPPED = [
  'Courses with blocks, pages, and a recording attached to the page it belongs to.',
  'A free page of a paid course, so a learner reads before taking a place.',
  'One-to-one and small-group classes, booked out of the minutes a teacher opened.',
  'A room for the class that opens in its window and not a minute before.',
  'Email at every turn of the loop, sent when the decision was made rather than nightly.',
  'A record of who changed what, and a desk that reads it back.',
] as const;

const NOT_YET = [
  'A price is shown, and no payment is taken. Money is the next thing built here.',
  'One booked minute is a class; a week that repeats itself on its own is not built yet.',
  'A teacher is found by a link someone sent you, not by a search that ranks them.',
] as const;

export function StatusSection() {
  return (
    <section aria-labelledby="status" className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24">
      <div className="max-w-reading">
        <p className="text-eyebrow uppercase text-brand">Where we are</p>
        <h2
          id="status"
          className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.011em] text-ink-strong sm:text-[2rem]"
        >
          What works today
        </h2>
        <p className="mt-4 text-h3 leading-relaxed text-ink-muted">
          We ship what is ready and say what is not. This is the current state of
          the platform, written as of the last deployment.
        </p>
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <div
          data-reveal=""
          style={{ '--reveal-delay': '0ms' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-pill bg-success" aria-hidden="true" />
            <p className="text-eyebrow uppercase text-success">Built, tested, clickable</p>
          </div>
          <MarkerList tone="shipped" lines={SHIPPED} />
        </div>

        <div
          data-reveal=""
          style={{ '--reveal-delay': '90ms' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-pill border border-line-strong" aria-hidden="true" />
            <p className="text-eyebrow uppercase text-warning">Not yet, said as not yet</p>
          </div>
          <MarkerList tone="pending" lines={NOT_YET} />
        </div>
      </div>
    </section>
  );
}

function MarkerList({
  lines,
  tone,
}: {
  lines: readonly string[];
  tone: 'shipped' | 'pending';
}) {
  const dot =
    tone === 'pending'
      ? 'border border-line-strong bg-transparent'
      : 'bg-success';

  return (
    <ul className="mt-5 space-y-3 text-label leading-relaxed text-ink">
      {lines.map((line) => (
        <li key={line} className="flex gap-3">
          <span
            aria-hidden="true"
            className={cn('mt-[0.45rem] size-1.5 shrink-0 rounded-pill', dot)}
          />
          <span className={tone === 'pending' ? 'text-ink-muted' : undefined}>{line}</span>
        </li>
      ))}
    </ul>
  );
}
