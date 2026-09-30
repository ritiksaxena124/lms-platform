/**
 * The problem → solution bridge. Explains the pain of running classes as an
 * independent teacher today, then shows how Hourloom addresses each part.
 * Uses a two-column comparison to make the contrast visible.
 */
export function ProblemSolution() {
  return (
    <section aria-labelledby="problem" className="border-y border-line bg-paper-sheen">
      <div className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24">
        <div className="max-w-reading">
          <p className="text-eyebrow uppercase text-brand">The problem</p>
          <h2
            id="problem"
            className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.011em] text-ink-strong sm:text-[2rem]"
          >
            Teaching independently means running the machinery yourself
          </h2>
          <p className="mt-4 text-h3 leading-relaxed text-ink-muted">
            You know the subject. What you don't have is a single place where the
            course, the calendar, the booking, the room, and the record live
            together — without giving up the decisions that make it your class.
          </p>
        </div>

        <div
          className="mt-12 grid gap-6 md:grid-cols-2"
          data-reveal=""
          style={{ '--reveal-delay': '120ms' } as React.CSSProperties}
        >
          <div className="rounded-card border border-line bg-surface px-6 py-6">
            <p className="text-eyebrow uppercase text-ink-faint">Without Hourloom</p>
            <ul className="mt-4 space-y-3">
              {[
                'Course content scattered across documents, drives, and platforms',
                'Availability managed in a personal calendar, copied by hand',
                'Booking handled over email or messaging, with no confirmation loop',
                'Calls set up in a generic tool, with links sent manually',
                'No single record of what was agreed, taught, or attended',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-label leading-relaxed text-ink-muted">
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    className="mt-0.5 size-4 shrink-0 text-ink-faint"
                    aria-hidden="true"
                  >
                    <path d="M6 10h8" />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-card border border-brand-line bg-brand-soft/30 px-6 py-6">
            <p className="text-eyebrow uppercase text-brand">With Hourloom</p>
            <ul className="mt-4 space-y-3">
              {[
                'Courses built from blocks and pages, with recordings attached where they belong',
                'A calendar you draw yourself, in your timezone, visible to learners',
                'A request-and-answer loop: the teacher sees who is asking, then decides',
                'A room that opens at the booked time, linked in the same email',
                'An audit trail of every decision, readable from the ops desk',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-label leading-relaxed text-ink">
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 size-4 shrink-0 text-brand"
                    aria-hidden="true"
                  >
                    <path d="M5 10.5l3.5 3L15 7" />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
