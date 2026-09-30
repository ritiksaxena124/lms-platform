import { buttonClass } from '@lms/ui';

import type { PortalUrls } from '@/lib/portals';

/**
 * Final call-to-action, placed after the FAQ. Simple and direct — the visitor
 * has read everything, and the question now is "what do I do next?"
 */
export function FinalCTA({ portals }: { portals: PortalUrls }) {
  return (
    <section
      aria-label="Get started"
      className="bg-brand-wash"
    >
      <div className="mx-auto max-w-page px-5 py-20 text-center lg:px-8 lg:py-28">
        <h2 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.011em] text-ink-strong sm:text-[2.25rem]">
          Open your first class
        </h2>
        <p className="mx-auto mt-4 max-w-reading text-h3 leading-relaxed text-ink-muted">
          Teachers set their own minutes, their own prices, and their own answers.
          Start with the teacher portal, or explore as a learner.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
        </div>
      </div>
    </section>
  );
}
