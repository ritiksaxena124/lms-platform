import Link from 'next/link';

import { cn } from '@lms/ui';

import type { PortalUrls } from '@/lib/portals';

/**
 * The one piece of chrome on a site that is otherwise a scroll and a set of documents.
 *
 * It carries the wordmark, the docs, and the two doors a visitor can walk through. The links out are
 * marked as links out: a landing page is the one place where leaving is the point, and a click that
 * changes the address bar should have said it would.
 */
export function SiteHeader({ portals }: { portals: PortalUrls }) {
  return (
    <header className="border-b border-line bg-surface">
      {/* Four links and a name in one row is more than a phone holds, and the row that cannot fit
       * them scrolls the page sideways instead. Both halves wrap: nothing is hidden at a width, and
       * the wordmark keeps its own line rather than breaking mid-phrase. */}
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 lg:px-8">
        <Link
          href="/"
          className="flex items-baseline gap-2 whitespace-nowrap text-h2 text-ink-strong"
        >
          <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
          Hourloom
        </Link>

        <nav
          aria-label="The portals and the documentation"
          className="ml-auto flex flex-wrap items-center justify-end gap-1"
        >
          <Link href="/docs" className={LINK_CLASS}>
            Docs
          </Link>
          <ExitLink href={portals.student}>Student portal</ExitLink>
          <ExitLink href={portals.teacher}>Teacher portal</ExitLink>
        </nav>
      </div>
    </header>
  );
}

const LINK_CLASS = cn(
  'whitespace-nowrap rounded-field px-3 py-2 text-label text-ink-muted',
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
  'hover:bg-paper-sunk hover:text-ink',
);

/**
 * A link that leaves. `rel` is not decoration here: `target="_blank"` hands the new tab a
 * `window.opener` that can point this page somewhere else, and a public page should not be able to be
 * turned into a doorway by a site it merely linked to.
 */
function ExitLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {children}
    </a>
  );
}
