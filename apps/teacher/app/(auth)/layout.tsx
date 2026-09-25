import { Illo } from '@lms/ui';

/**
 * The two-column shell for a screen that has no session yet: the pitch on the left,
 * the form on the right, and no navigation to click while you are still outside.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main"
      className="mx-auto grid min-h-dvh w-full max-w-page content-center gap-10 px-5 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16 lg:px-6 xl:px-10"
    >
      <section className="hidden lg:block">
        <p className="eyebrow text-brand-deep">Teacher portal</p>
        {/* The page owns the `h1`; this is the pitch beside it, not another heading. */}
        <p className="mt-2 block max-w-[18ch] text-h1 text-ink-strong">
          Your calendar, your rates, your classes.
        </p>
        <p className="mt-3 max-w-[48ch] text-[0.9375rem] leading-relaxed text-ink-muted">
          Publish a course, take requests from students and run the session — without a spreadsheet
          in between.
        </p>
        <Illo src="/illustrations/peep-standing-11.svg" size="lg" className="mt-6 justify-start" />
      </section>

      <section className="w-full self-center rounded-sheet border border-line bg-surface p-6">
        <p className="mb-6 flex items-baseline gap-2 text-h2 text-ink-strong">
          <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
          Teacher
        </p>
        {children}
      </section>
    </main>
  );
}
