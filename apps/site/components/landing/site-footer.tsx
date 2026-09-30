import Link from 'next/link';

/**
 * A clean footer with only links that actually exist. The site has docs and
 * the two portals — we do not invent pages that don't exist yet.
 */
export function SiteFooter({
  portals,
}: {
  portals: { teacher: string; student: string };
}) {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-page px-5 py-12 lg:px-8 lg:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <Link
              href="/"
              className="flex items-baseline gap-2 text-h2 text-ink-strong"
            >
              <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
              Hourloom
            </Link>
            <p className="mt-3 max-w-[260px] text-label leading-relaxed text-ink-muted">
              1:1 and small-group classes with independent teachers. One API,
              three portals, one component library, one database.
            </p>
          </div>

          {/* Product — in-page anchors, not routes */}
          <div>
            <p className="text-eyebrow uppercase text-ink-faint">Product</p>
            <ul className="mt-3 space-y-2">
              <li>
                <a href="#how-it-works" className="text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink">
                  How it works
                </a>
              </li>
              <li>
                <a href="#features" className="text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink">
                  Features
                </a>
              </li>
              <li>
                <a href="#status" className="text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink">
                  What&apos;s built
                </a>
              </li>
              <li>
                <a href="#faq" className="text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          {/* Portals */}
          <div>
            <p className="text-eyebrow uppercase text-ink-faint">Portals</p>
            <ul className="mt-3 space-y-2">
              <FooterExitLink href={portals.teacher}>Teacher portal</FooterExitLink>
              <FooterExitLink href={portals.student}>Student portal</FooterExitLink>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <p className="text-eyebrow uppercase text-ink-faint">Resources</p>
            <ul className="mt-3 space-y-2">
              <FooterLink href="/docs">Documentation</FooterLink>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-8">
          <p className="text-label text-ink-faint">
            Hourloom — a working proof.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink"
      >
        {children}
      </Link>
    </li>
  );
}

function FooterExitLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-label text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink"
      >
        {children}
      </a>
    </li>
  );
}
