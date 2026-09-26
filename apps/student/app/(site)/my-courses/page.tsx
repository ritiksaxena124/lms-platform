import type { Metadata } from 'next';
import { RouteTransition } from '@lms/ui';

import { MyCourses } from '@/components/my-courses';
import { RequireSession } from '@/components/require-session';

export const metadata: Metadata = {
  title: 'My courses',
  description: 'The courses you hold a place in.',
};

/**
 * The one screen on this portal that is nobody else's list.
 *
 * It is gated in the client rather than in middleware for the reason §13 gives: the refresh
 * cookie is scoped to `/api/v1/auth`, so a page-path middleware could not see it even if a page
 * render were allowed to ask the API. `RequireSession` asks the same provider the header asks,
 * which means a visitor who typed this address while signed out is on the sign-in form with
 * this path in the `next` before they have read a word of it.
 */
export default function MyCoursesPage() {
  return (
    <RouteTransition>
      <RequireSession>
        <header>
          <h1 className="text-h1 text-ink-strong">My courses</h1>
          <p className="mt-1 max-w-[52ch] text-[0.9375rem] text-ink-muted">
            Every course you hold a place in, with the pages it lists open to you.
          </p>
        </header>

        <MyCourses />
      </RequireSession>
    </RouteTransition>
  );
}
