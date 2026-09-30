/**
 * Large feature blocks — not a 3-column grid of generic cards but distinct
 * sections that each tell a single story about what the platform does.
 *
 * Each feature block alternates layout direction to create visual rhythm.
 */

const FEATURES = [
  {
    eyebrow: 'Course authoring',
    title: 'Write once, teach many times',
    description:
      'A course is blocks, pages, and a recording attached to the page it belongs to. Blocks group what belongs together. Pages hold the content a learner actually reads. Recordings sit on the page they explain.',
    details: [
      'Structured as blocks and pages — not a flat list of videos',
      'Recordings attached to the page they explain, not dumped in a folder',
      'A free page of a paid course, so the learner reads before deciding',
    ],
  },
  {
    eyebrow: 'Availability',
    title: 'Your week, drawn by you',
    description:
      "Open the minutes you are free, in your own timezone. The calendar understands daylight saving, summer breaks, and the weeks you simply don't teach. A learner sees only what is actually open.",
    details: [
      "Minutes drawn on a calendar in the teacher's own clock",
      'Timezone-aware — what a learner sees adjusts to where they are',
      'Nothing is open until the teacher marks it open',
    ],
  },
  {
    eyebrow: 'Booking & rooms',
    title: 'A request, an answer, a room',
    description:
      'A learner picks a time and sends a request. The teacher sees who is asking and what they are booking, then says yes or no. If yes, a room opens at the booked time. If no, the learner hears so immediately.',
    details: [
      'One-to-one and small-group classes, booked the same way',
      'A room that opens in its window and not a minute before',
      'Email before the class, with the room, and a confirmation after',
    ],
  },
] as const;

export function Features() {
  return (
    <section aria-labelledby="features" className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24">
      <div className="max-w-reading">
        <p className="text-eyebrow uppercase text-brand">What's built</p>
        <h2
          id="features"
          className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.011em] text-ink-strong sm:text-[2rem]"
        >
          The pieces that make a class work
        </h2>
      </div>

      <div className="mt-14 space-y-16 lg:space-y-24">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.eyebrow}
            data-reveal=""
            style={{ '--reveal-delay': `${i * 60}ms` } as React.CSSProperties}
            className="grid items-start gap-8 lg:grid-cols-2 lg:gap-16"
          >
            <div className={i % 2 === 1 ? 'lg:order-2' : undefined}>
              <p className="text-eyebrow uppercase text-brand">{feature.eyebrow}</p>
              <h3 className="mt-2 text-h1 text-ink-strong">{feature.title}</h3>
              <p className="mt-4 max-w-reading text-label leading-relaxed text-ink-muted">
                {feature.description}
              </p>
            </div>

            <div className={i % 2 === 1 ? 'lg:order-1' : undefined}>
              <ul className="space-y-3 rounded-card border border-line bg-surface px-6 py-6">
                {feature.details.map((detail) => (
                  <li key={detail} className="flex gap-3 text-label leading-relaxed text-ink">
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-hidden="true"
                    >
                      <path d="M5 10.5l3.5 3L15 7" />
                    </svg>
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
