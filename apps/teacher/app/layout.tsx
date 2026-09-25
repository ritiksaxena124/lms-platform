import type { Metadata, Viewport } from 'next';

import { Toaster } from '@lms/ui';

import { AppNav } from '@/components/app-nav';
import './globals.css';

/* Inter is loaded once by @lms/ui/styles.css, self-hosted from
 * @fontsource-variable/inter, so the portal adds no font request of its own. */

export const metadata: Metadata = {
  title: {
    default: 'Teacher · LMS',
    template: '%s · Teacher · LMS',
  },
  description: 'Your courses, bookings and schedule in one place.',
};

export const viewport: Viewport = {
  themeColor: '#f7f8f9',
};

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

        <div className="mx-auto flex min-h-dvh w-full max-w-page flex-col gap-6 lg:flex-row lg:gap-10 lg:px-6 xl:px-10">
          <AppNav />
          <main id="main" className="min-w-0 flex-1 px-5 py-8 lg:px-0 lg:py-10">
            {children}
          </main>
        </div>

        <Toaster />
      </body>
    </html>
  );
}
