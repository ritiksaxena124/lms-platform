import Link from 'next/link';
import { buttonClass } from '@lms/ui';

/**
 * The page a teacher lands on when they follow a link to a course that was archived, or a series
 * that was retired. Not an error — the thing they were looking for simply moved on.
 *
 * Uses an OpenPeeps illustration to keep the tone light: "this path is quiet" rather than "you
 * broke something". The gradient mesh background matches the app's brand without repeating the
 * chrome of every other screen.
 */
export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-paper">
      {/* Gradient mesh atmosphere */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 20% 30%, rgba(251, 146, 60, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(251, 146, 60, 0.1) 0%, transparent 50%)',
        }}
      />

      <div className="relative z-10 flex max-w-md flex-col items-center text-center">
        {/* Illustration placeholder using CSS shapes */}
        <div className="mb-8 relative">
          <div className="h-48 w-48 rounded-full bg-gradient-to-br from-ember/20 to-ember/5 flex items-center justify-center">
            <svg
              viewBox="0 0 200 200"
              className="h-40 w-40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Abstract question mark in brand colors */}
              <path
                d="M100 40c-15 0-28 8-28 22 0 10 6 16 14 20 6 3 8 6 8 12v8h12v-8c0-10 4-14 12-18 10-5 16-12 16-24 0-18-16-24-34-24zm-6 72h12v24h-12z"
                fill="currentColor"
                className="text-ember"
              />
              {/* Decorative dots */}
              <circle cx="50" cy="50" r="4" fill="currentColor" className="text-ember/30" />
              <circle cx="150" cy="150" r="6" fill="currentColor" className="text-ember/20" />
              <circle cx="40" cy="140" r="3" fill="currentColor" className="text-ember/25" />
            </svg>
          </div>
        </div>

        <h1 className="text-h1 text-ink-strong">Page not found</h1>
        <p className="mt-4 text-body text-ink-muted">
          The page you're looking for doesn't exist — it may have been moved, archived, or never
          existed in the first place.
        </p>

        <div className="mt-8 flex gap-3">
          <Link href="/" className={buttonClass({ variant: 'primary' })}>
            Back to overview
          </Link>
          <Link href="/courses" className={buttonClass({ variant: 'secondary' })}>
            View courses
          </Link>
        </div>
      </div>
    </div>
  );
}
