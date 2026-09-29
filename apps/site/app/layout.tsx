import type { Metadata, Viewport } from 'next';

import { SiteHeader } from '@/components/site-header';
import { readPortalUrls } from '@/lib/portals';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Teacher Marketplace — 1:1 classes with independent teachers',
    template: '%s · Teacher Marketplace',
  },
  description:
    'A marketplace for one-to-one and small-group classes. Teachers write the course and open the week they teach; learners read it, take a place, and book a minute of the teacher’s time.',
};

export const viewport: Viewport = {
  themeColor: '#f7f8f9',
};

/**
 * The face of the product, and the only workspace here with no session, no API call and no server
 * half. It is built as files rather than served as an app (see `next.config.ts`), so the promise the
 * roadmap makes — "not a second backend" — is a property of the build rather than a intention kept in
 * a comment.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="font-sans">
      <body className="min-h-dvh bg-paper text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-field focus:border focus:border-line-strong focus:bg-surface focus:px-3 focus:py-2 focus:text-label"
        >
          Skip to content
        </a>

        <SiteHeader portals={readPortalUrls()} />

        <main id="main">{children}</main>
      </body>
    </html>
  );
}
