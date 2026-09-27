import type { Metadata } from 'next';
import { RouteTransition } from '@lms/ui';

import { BookAClass } from '@/components/book-a-class';
import { RequireSession } from '@/components/require-session';

export const metadata: Metadata = {
  title: 'Book a class',
  description: 'The class times this teacher is offering you for this course.',
};

/**
 * When this teacher will teach you, and the one minute you are asking for.
 *
 * The address is keyed by the course rather than by the teacher, which is what the offer actually
 * is about: a teacher is free at a hundred instants across a month, and what a student may take is
 * the subset this course opens to them — every class in it, if they hold a place, or a single trial
 * call if the teacher has opened the door and they do not.
 *
 * Gated in the client like the shelf a student is inside, for the same reason §13 gives: the
 * refresh cookie is scoped to `/api/v1/auth`, so a visitor who typed this address is sent to the
 * sign-in form with this path in the `next`, and lands here signed in.
 */
export default async function BookClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteTransition>
      <RequireSession>
        <header className="mb-6">
          <h1 className="text-h1 text-ink-strong">Book a class</h1>
          <p className="mt-1 max-w-[52ch] text-[0.9375rem] text-ink-muted">
            Pick a time the teacher keeps open. They confirm it before it goes on your calendar.
          </p>
        </header>

        <BookAClass courseId={id} />
      </RequireSession>
    </RouteTransition>
  );
}
