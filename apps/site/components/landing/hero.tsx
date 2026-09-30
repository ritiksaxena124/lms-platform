import Link from 'next/link';

import { buttonClass, Stagger } from '@lms/ui';

import type { PortalUrls } from '@/lib/portals';

/**
 * The first thing a visitor sees. It answers: "What is this, and why should I
 * care?" in under five seconds. The layout is deliberately asymmetric — text
 * anchors the left, the animated workflow anchors the right — so the eye moves
 * from the claim to the proof.
 */
export function Hero({ portals }: { portals: PortalUrls }) {
  return (
    <section aria-labelledby="pitch" className="border-b border-line bg-paper-sheen">
      <div className="mx-auto max-w-page px-5 py-16 lg:px-8 lg:py-24">
        <Stagger className="grid items-center gap-12 lg:grid-cols-[1fr_minmax(0,420px)]">
          <div>
            <p className="text-eyebrow uppercase text-brand">
              One teacher, one learner, one room
            </p>
            <h1
              id="pitch"
              className="mt-3 max-w-reading text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.022em] text-ink-strong sm:text-[3.25rem]"
            >
              The class you teach is the shop you keep
            </h1>
            <p className="mt-5 max-w-reading text-h3 leading-relaxed text-ink-muted">
              Hourloom runs 1:1 and small-group classes for independent teachers.
              Write your course, open the hours you actually teach, and let
              learners book a place in your calendar — not somebody else's
              platform.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={portals.teacher}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ size: 'lg' })}
              >
                Teacher portal
              </a>
              <a
                href={portals.student}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: 'secondary', size: 'lg' })}
              >
                Student portal
              </a>
              <Link href="/docs" className={buttonClass({ variant: 'ghost', size: 'lg' })}>
                Read the docs
              </Link>
            </div>

            <p className="mt-6 max-w-reading text-label leading-relaxed text-ink-faint">
              Free to use while we build. Payments are the next thing — nothing
              here charges you yet, and nothing pretends to.
            </p>
          </div>

          <HeroVisual />
        </Stagger>
      </div>
    </section>
  );
}

/**
 * An animated representation of the core Hourloom workflow. Four cards
 * stagger in, each representing one beat of the class lifecycle. The
 * cards use the existing reveal animation from the design system.
 */
function HeroVisual() {
  const steps = [
    {
      label: 'Write',
      description: 'A teacher builds a course — blocks, pages, recordings.',
      icon: (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <path d="M4 4h12v12H4z" />
          <path d="M4 8h12M8 8v8" />
        </svg>
      ),
    },
    {
      label: 'Open',
      description: 'They mark the hours they are free, in their own clock.',
      icon: (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <circle cx="10" cy="10" r="6.8" />
          <path d="M10 6.2V10l3.1 1.9" />
        </svg>
      ),
    },
    {
      label: 'Book',
      description: 'A learner reads the course, takes a place, picks a time.',
      icon: (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <circle cx="10" cy="7.4" r="3.3" />
          <path d="M4.4 16.6c0-2.7 2.5-4.4 5.6-4.4s5.6 1.7 5.6 4.4" />
        </svg>
      ),
    },
    {
      label: 'Meet',
      description: 'A room opens at the booked time. Both get email before and after.',
      icon: (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <path d="M3.2 6.2 10 10.6l6.8-4.4" />
          <rect x="3.2" y="4.4" width="13.6" height="11.2" rx="2" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative hidden lg:block" aria-hidden="true">
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={step.label}
            data-reveal=""
            style={{ '--reveal-delay': `${400 + i * 120}ms` } as React.CSSProperties}
            className="flex items-start gap-4 rounded-card border border-line bg-surface px-5 py-4 transition-shadow duration-[var(--duration-base)] ease-[var(--ease-out)] hover:shadow-overlay"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-field bg-brand-soft text-brand">
              {step.icon}
            </div>
            <div>
              <p className="text-label font-semibold text-ink-strong">{step.label}</p>
              <p className="mt-0.5 text-label text-ink-muted">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Connecting line between steps */}
      <div
        className="absolute left-[37px] top-[52px] w-px bg-line"
        style={{ height: 'calc(100% - 104px)' }}
      />
    </div>
  );
}
