'use client';

import Link from 'next/link';
import { Skeleton, buttonClass, cn, notify } from '@lms/ui';

import { useSession } from './session-provider';

/**
 * The header's account corner.
 *
 * It reads the same session the screens below read, which is the only way one portal can show
 * a shelf to a stranger and a syllabus of open pages to a member without the chrome contradict
 * either. Two states stay quiet on purpose: while the boot read is in flight, and when the API
 * could not be reached at all, a `Sign in` link here would promise a form that cannot reach it
 * either — and the unreachable case already carries a retry where the visitor is looking.
 */
export function SiteAccount() {
  const { status, user, signOut } = useSession();

  if (status === 'signed-in' && user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/my-courses"
          className={cn(buttonClass({ variant: 'secondary', size: 'sm' }))}
        >
          My courses
        </Link>
        <span className="hidden text-[0.8125rem] text-ink-muted sm:inline">{user.fullName}</span>
        <button
          type="button"
          onClick={() => {
            void signOut()
              .then(() => notify.success('Signed out'))
              .catch(() =>
                notify.error('The API could not hear the goodbye, but this device has let go.'),
              );
          }}
          className={cn(buttonClass({ variant: 'ghost', size: 'sm' }))}
        >
          Sign out
        </button>
      </div>
    );
  }

  if (status === 'bootstrapping') {
    return (
      <div role="status" aria-label="Checking whether you are signed in">
        <Skeleton className="h-8 w-40 rounded-field" />
      </div>
    );
  }

  if (status !== 'signed-out') return null;

  return (
    <Link href="/login" className={cn(buttonClass({ variant: 'secondary', size: 'sm' }))}>
      Sign in
    </Link>
  );
}
