import Link from 'next/link';

import { SiteAccount } from '@/components/site-account';

/**
 * The public frame: a header that says whose shelf this is and who is standing in front of it,
 * and a column that stops short of the viewport edges.
 *
 * The teacher portal is a viewport-height frame with one scrolling column, because it is a
 * tool somebody sits in for hours. This is a shelf a visitor walks past, so it scrolls as a
 * document does — which is also why there is no sidebar to hold still, and why the account
 * corner is one line in a header rather than a column of its own.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-(--container-page) items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <Link
            href="/"
            className="flex items-baseline gap-2 text-h2 text-ink-strong"
            aria-label="Learn — go to the shelf"
          >
            <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
            Learn
          </Link>

          <SiteAccount />
        </div>
      </header>

      <main
        id="main"
        className="mx-auto w-full max-w-(--container-page) px-5 py-8 lg:px-8 lg:py-12"
      >
        {children}
      </main>

      <footer className="mt-8 border-t border-line">
        <div className="mx-auto w-full max-w-(--container-page) px-5 py-8 text-[0.8125rem] text-ink-faint lg:px-8">
          Courses are written by the teachers who publish them. Booking and payment are still being
          built on this portal.
        </div>
      </footer>
    </>
  );
}
