/**
 * Architecture overview — legitimate information about how Hourloom is built.
 * No fake claims, no invented metrics. Just the actual technical architecture
 * described for a technical audience that cares about how their data is handled.
 */
export function Architecture() {
  const facts = [
    {
      label: 'One API',
      detail: 'A single NestJS backend serves all three portals. One source of truth, one set of validations.',
    },
    {
      label: 'Three portals',
      detail: 'Teacher, student, and ops — each a separate app with its own concerns, sharing one component library.',
    },
    {
      label: 'One database',
      detail: 'PostgreSQL, with every write recorded in an audit trail that the ops desk reads back.',
    },
    {
      label: 'Static public site',
      detail: 'This page is a static export — no server, no session, no API call. The public face is files, not an app.',
    },
    {
      label: 'Open-source stack',
      detail: 'Built on Next.js, NestJS, PostgreSQL, TypeScript, and Tailwind. No proprietary runtime.',
    },
    {
      label: 'Timezone-aware',
      detail: 'The calendar, the booking, and the room all respect the timezone of the person looking at them.',
    },
  ] as const;

  return (
    <section aria-labelledby="architecture" className="border-t border-line bg-paper-sheen">
      <div className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24">
        <div className="max-w-reading">
          <p className="text-eyebrow uppercase text-brand">Under the surface</p>
          <h2
            id="architecture"
            className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.011em] text-ink-strong sm:text-[2rem]"
          >
            How Hourloom is built
          </h2>
          <p className="mt-4 text-h3 leading-relaxed text-ink-muted">
            A working proof: one API, three portals, one component library, one
            database. The architecture is a constraint, not a sales pitch.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact, i) => (
            <div
              key={fact.label}
              data-reveal=""
              style={{ '--reveal-delay': `${i * 60}ms` } as React.CSSProperties}
              className="rounded-card border border-line bg-surface px-5 py-5"
            >
              <p className="text-label font-semibold text-ink-strong">{fact.label}</p>
              <p className="mt-2 text-label leading-relaxed text-ink-muted">{fact.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
