import type { Metadata, Viewport } from 'next';

import { Toaster } from '@lms/ui';

import { SessionProvider } from '@/components/session-provider';
import './globals.css';

/* Inter is loaded once by @lms/ui/styles.css, self-hosted from @fontsource-variable/inter,
 * so this portal adds no font request of its own. */

export const metadata: Metadata = {
  title: {
    default: 'Learn · LMS',
    template: '%s · Learn · LMS',
  },
  description: 'Browse the courses teachers have published, and see exactly what you would be reading.',
};

export const viewport: Viewport = {
  themeColor: '#f7f8f9',
};

/**
 * The public shell, holding the one thing on this portal that is not public: the session. The
 * provider mounts here rather than in the site layout because the sign-in screens need it too,
 * and a portal that worked out who you were twice could answer twice — not always in the same
 * voice. The toasts come along for the same reason: signing out happens in the header and is
 * answered there. A screen that cannot reach the API still says so itself.
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
