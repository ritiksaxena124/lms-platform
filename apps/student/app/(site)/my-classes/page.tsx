import type { Metadata } from 'next';
import { RouteTransition } from '@lms/ui';

import { MyClasses } from '@/components/my-classes';
import { RequireSession } from '@/components/require-session';

export const metadata: Metadata = {
  title: 'My classes',
  description: 'The live classes you have asked for, on your own clock.',
};

/**
 * The student's calendar, gated the same way `My courses` is (§13): the refresh cookie is scoped
 * to `/api/v1/auth`, so the client session provider is the only thing here that can know who is
 * looking.
 *
 * It is a page rather than a strip on the course page because a student with three teachers has
 * one schedule and three courses, and the question "what do I have on Thursday" is not asked of a
 * course.
 */
export default function MyClassesPage() {
  return (
    <RouteTransition>
      <RequireSession>
        <header>
          <h1 className="text-h1 text-ink-strong">My classes</h1>
          <p className="mt-1 max-w-[52ch] text-[0.9375rem] text-ink-muted">
            Every class you have asked for, read in your own timezone.
          </p>
        </header>

        <div className="mt-6">
          <MyClasses />
        </div>
      </RequireSession>
    </RouteTransition>
  );
}
