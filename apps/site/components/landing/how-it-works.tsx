/**
 * The four beats of a class, told as a narrative the visitor walks through.
 * Each step names who acts and what happens, because the product's value
 * is that every decision has one owner and every step has a record.
 */

const STEPS = [
  {
    number: '01',
    actor: 'A teacher',
    action: 'writes the course',
    detail:
      'Blocks, pages, and a recording attached to the page it belongs to. A free page of a paid course lets a learner read before deciding.',
  },
  {
    number: '02',
    actor: 'A learner',
    action: 'reads and asks for a minute',
    detail:
      "They read the course, find a minute that is actually open — shown in the learner's own clock — and send a request for that teacher's time.",
  },
  {
    number: '03',
    actor: 'The teacher answers',
    action: 'yes or no',
    detail:
      'Yes, and the class gets a room of its own. No, and the learner hears so. Nobody sits in an empty call waiting.',
  },
  {
    number: '04',
    actor: 'Both are told',
    action: 'before and after',
    detail:
      'Email at every turn of the loop, sent when the decision was made rather than nightly. Every one of those decisions leaves a record the platform can be asked about.',
  },
] as const;

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works"
      className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24"
    >
      <div className="max-w-reading">
        <p className="text-eyebrow uppercase text-brand">How a class happens</p>
        <h2
          id="how-it-works"
          className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.011em] text-ink-strong sm:text-[2rem]"
        >
          Four decisions, four records
        </h2>
        <p className="mt-4 text-h3 leading-relaxed text-ink-muted">
          Every class on Hourloom follows the same loop. Each step names who acts, because the
          reason a teacher stays is that the answers are theirs to give.
        </p>
      </div>

      <ol
        aria-label="How a class happens"
        className="relative mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        {STEPS.map((step, i) => (
          <li
            key={step.number}
            data-reveal=""
            style={{ '--reveal-delay': `${i * 90}ms` } as React.CSSProperties}
            className="group relative rounded-card border border-line bg-surface px-5 py-6 transition-colors duration-[var(--duration-base)] ease-[var(--ease-out)] hover:border-brand-line hover:bg-brand-soft/30"
          >
            <span className="text-metric text-brand/30 font-semibold">{step.number}</span>
            <p className="mt-3 text-label font-semibold text-ink-strong">
              <span className="text-brand">{step.actor}</span> {step.action}
            </p>
            <p className="mt-2 text-label leading-relaxed text-ink-muted">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
