import type { Metadata, Viewport } from 'next';

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
 * The public shell. There is no session to hold and no toast to raise: everything on this
 * portal so far is a read that either arrives or does not, and a screen that cannot reach the
 * API says so itself rather than being told twice.
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

        {children}
      </body>
    </html>
  );
}
