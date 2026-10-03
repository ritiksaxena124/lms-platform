'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ROLE_CODES } from '@lms/shared';
import { EmptyState, ErrorState, SkeletonGroup } from '@lms/ui';

import { useSession } from './session-provider';

/**
 * Gates a screenful of private work, and holds it to one role.
 *
 * This lives in the client, not in Next middleware, on purpose: the refresh cookie is scoped to
 * `Path=/api/v1/auth`, so no middleware running on a page path can ever see it. The one place that
 * can answer "are you signed in?" is the same place that trades the cookie for a session — here,
 * after the provider has asked.
 *
 * The role check is a courtesy on top of the API's refusal, not the refusal itself. Every route this
 * portal calls asks for an operator's capability on the server, and a teacher's session would find
 * that out from four 403s; what this saves them is a page of empty tables dressed up as an ops desk,
 * and what it saves the platform from is an operator's shoulder shrug at a screen that said nothing.
 *
 * A refusal does not redirect. Sending the person to the sign-in page would put a password box in
 * front of somebody who has just proved who they are, and the two facts — you are signed in, and you
 * are not ops — are worth stating together rather than collapsing into "sign in again".
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status, user, retry, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const signInHref = `/login?next=${encodeURIComponent(pathname)}`;

  useEffect(() => {
    if (status === 'signed-out') router.replace(signInHref);
  }, [status, router, signInHref]);

  if (status === 'unreachable') {
    return (
      <ErrorState
        title="We could not check your session"
        message="The portal could not reach the API, so nothing was loaded. Your sign-in is untouched."
        onRetry={retry}
      />
    );
  }

  if (status === 'signed-in' && user) {
    return user.role === ROLE_CODES.OPS ? (
      <>{children}</>
    ) : (
      <EmptyState
        title="This desk is for the ops role"
        description={`${user.fullName} is signed in with the ${user.role} role, and the ledger, the accounts and the queue are not that role's to read. Nothing was fetched, and nothing was refused on your behalf.`}
        actionLabel="Sign out and try another account"
        onAction={() => {
          void signOut();
        }}
      />
    );
  }

  // `bootstrapping`, and the frame before the redirect lands: a page-shaped placeholder so the shell
  // does not collapse into a blank column.
  return (
    <div className="space-y-8">
      <SkeletonGroup rows={1} label="Checking your session" rowClassName="h-8 w-52" />
      <SkeletonGroup rows={3} rowClassName="h-20 w-full rounded-card" />
    </div>
  );
}

/**
 * The `?next=` a sign-in is allowed to honour.
 *
 * Anything that is not a root-relative path is dropped rather than followed: `//evil` is a
 * protocol-relative URL, `/\host` is treated as one by some browsers, and a scheme of its own would
 * leave this portal entirely.
 */
export function safeRedirectTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || !trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//') || trimmed.includes('\\')) return null;
  return trimmed;
}
