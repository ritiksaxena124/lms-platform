import type { Metadata, Viewport } from 'next';
import { Fraunces, JetBrains_Mono, Public_Sans } from 'next/font/google';

import { Toaster } from '@lms/ui';

import { AppNav } from '@/components/app-nav';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Teacher · LMS',
    template: '%s · Teacher · LMS',
  },
  description: 'Your courses, bookings and schedule in one place.',
};

export const viewport: Viewport = {
  themeColor: '#faf8f5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh bg-paper text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-field focus:bg-surface focus:px-3 focus:py-2 focus:text-label focus:shadow-raised"
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
