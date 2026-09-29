import Link from 'next/link';

import { cn } from '@lms/ui';

import type { PortalUrls } from '@/lib/portals';

/**
 * The one piece of chrome on a page that is otherwise a scroll.
 *
 * It carries the wordmark and the two doors a visitor can walk through — and nothing else, because
 * there is nothing else to navigate to. The links out are marked as links out: a landing page is the
 * one place where leaving is the point, and a click that changes the address bar should have said it
 * would.
 */
export function SiteHeader({ portals }: { portals: PortalUrls }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-page items-center gap-4 px-5 py-4 lg:px-8">
        <Link
          href="/"
          className="flex items-baseline gap-2 whitespace-nowrap text-h2 text-ink-strong"
        >
          <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
          Teacher Marketplace
        </Link>

        <nav aria-label="This page and the product" className="ml-auto flex items-center gap-1">
          <ExitLink href={portals.student}>Student portal</ExitLink>
          <ExitLink href={portals.teacher}>Teacher portal</ExitLink>
        </nav>
      </div>
    </header>
  );
}

/**
 * A link that leaves. `rel` is not decoration here: `target="_blank"` hands the new tab a
 * `window.opener` that can point this page somewhere else, and a public page should not be able to be
 * turned into a doorway by a site it merely linked to.
 */
function ExitLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'rounded-field px-3 py-2 text-label text-ink-muted',
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
        'hover:bg-paper-sunk hover:text-ink',
      )}
    >
      {children}
    </a>
  );
}
