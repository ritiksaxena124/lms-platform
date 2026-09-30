import type { Metadata, Viewport } from 'next';

import { Toaster } from '@lms/ui';

import { SessionProvider } from '@/components/session-provider';
import './globals.css';

/* Inter is loaded once by @lms/ui/styles.css, self-hosted from
 * @fontsource-variable/inter, so the portal adds no font request of its own. */

export const metadata: Metadata = {
  title: {
    default: 'Ops · Hourloom',
    template: '%s · Ops · Hourloom',
  },
  description: 'The accounts, the ledger and the notification queue for this platform.',
};

export const viewport: Viewport = {
  themeColor: '#f7f8f9',
};

/**
 * The root layout carries what every screen needs and nothing that belongs to one: the session, the
 * toasts, and the skip link.
 *
 * The provider here holds the *account*. The `(portal)/layout.tsx` below adds the question this
 * portal exists to ask — whether that account is `ops` — so a screen cannot be added by accident on
 * the wrong side of the door.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="font-sans">
      <body className="min-h-dvh bg-paper text-ink">
        <SessionProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-field focus:border focus:border-line-strong focus:bg-surface focus:px-3 focus:py-2 focus:text-label"
          >
            Skip to content
          </a>

          {children}

          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
