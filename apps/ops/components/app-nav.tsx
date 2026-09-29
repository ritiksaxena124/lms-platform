'use client';

import Link from 'next/link';
import { buttonClass, cn, notify, Skeleton } from '@lms/ui';

import { useSession } from './session-provider';

/**
 * The one element that never animates: content slides, the chrome stays put, so a navigation always
 * reads as "the page changed" rather than "the app moved".
 *
 * The screen links arrive with the screens (8d); what is here from the start is the account corner,
 * because on this portal the person standing in front of the screen is the fact most worth naming —
 * every row they read is somebody else's history, and every write is made in their own name.
 */
export function AppNav() {
  return (
    <aside
      style={{ viewTransitionName: 'app-chrome' }}
      className="shrink-0 border-line px-4 py-5 lg:flex lg:w-56 lg:flex-col lg:border-r lg:px-5 lg:py-10"
    >
      <Link
        href="/"
        transitionTypes={['nav-back']}
        className="flex items-baseline gap-2 text-h2 text-ink-strong"
      >
        <span aria-hidden="true" className="inline-block size-2 rounded-pill bg-ember" />
        Ops desk
      </Link>

      <AccountSlot />
    </aside>
  );
}

/**
 * Who this tab is acting as, and the one way to stop.
 *
 * Signing out has no redirect of its own: the session flips to signed-out, and `RequireSession`
 * sends the page away. Two places deciding where a signed-out person belongs is one too many, and
 * they would not always agree.
 */
function AccountSlot() {
  const { status, user, signOut } = useSession();

  if (status === 'signed-in' && user) {
    return (
      <div className="mt-6 border-t border-line pt-4 lg:mt-auto">
        <p className="truncate text-label text-ink">{user.fullName}</p>
        <p className="mt-0.5 truncate text-[0.75rem] text-ink-faint">{user.email}</p>
        <p className="mt-0.5 truncate text-[0.75rem] text-ink-faint">{user.role}</p>
        <button
          type="button"
          onClick={() => {
            void signOut()
              .then(() => notify.success('Signed out'))
              .catch(() =>
                notify.error('The API could not hear the goodbye, but this device has let go.'),
              );
          }}
          className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), 'mt-2 -ml-3')}
        >
          Sign out
        </button>
      </div>
    );
  }

  if (status === 'bootstrapping') return <Skeleton className="mt-6 h-12 w-full rounded-card" />;

  return (
    <div className="mt-6 border-t border-line pt-4 lg:mt-auto">
      <Link href="/login" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
        Sign in
      </Link>
    </div>
  );
}
