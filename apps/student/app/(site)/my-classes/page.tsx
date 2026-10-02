import type { Metadata } from 'next';
import { RouteTransition } from '@lms/ui';

import { MyClasses } from '@/components/my-classes';
import { RequireSession } from '@/components/require-session';

export const metadata: Metadata = {
  title: 'My classes',
  description: 'The classes on your calendar, asked for or scheduled, on your own clock.',
};

/**
 * The student's calendar, gated the same way `My courses` is (§13): the refresh cookie is scoped
 * to `/api/v1/auth`, so the client session provider is the only thing here that can know who is
 * looking.
 *
 * It is a page rather than a strip on the course page because a student with three teachers has
 * one schedule and three courses, and the question "what do I have on Thursday" is not asked of a
 * course. Nor is it two lists: half the rows are minutes this person pressed to book and half are
 * classes a course's series scheduled, and a person with a diary that splits what they chose from
 * what was chosen for them is a person who misses one of them.
 */
export default function MyClassesPage() {
  return (
    <RouteTransition>
      <RequireSession>
        <header>
          <h1 className="text-h1 text-ink-strong">My classes</h1>
          <p className="mt-1 max-w-[52ch] text-[0.9375rem] text-ink-muted">
            Every class you are expected at, read in your own timezone.
          </p>
        </header>

        <div className="mt-6">
          <MyClasses />
        </div>
      </RequireSession>
    </RouteTransition>
  );
}
