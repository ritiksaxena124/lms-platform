'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ErrorState, SkeletonGroup } from '@lms/ui';

import { useSession } from './session-provider';

/**
 * Gates a screenful of private work.
 *
 * This lives in the client, not in Next middleware, on purpose: the refresh cookie is
 * scoped to `Path=/api/v1/auth`, so no middleware running on a page path can ever see it.
 * The one place that can answer "are you signed in?" is the same place that trades the
 * cookie for a session — here, after the provider has asked.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status, retry } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const signInHref = `/login?next=${encodeURIComponent(pathname)}`;

  useEffect(() => {
    if (status === 'signed-out') router.replace(signInHref);
  }, [status, router, signInHref]);

  if (status === 'signed-in') return <>{children}</>;

  if (status === 'unreachable') {
    return (
      <ErrorState
        title="We could not check your session"
        message="The portal could not reach the API, so nothing was loaded. Your sign-in is untouched."
        onRetry={retry}
      />
    );
  }

  // `bootstrapping`, and the frame before the redirect lands: a page-shaped placeholder
  // so the shell does not collapse into a blank column.
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
 * Anything that is not a root-relative path is dropped rather than followed: `//evil`
 * is a protocol-relative URL, `/\host` is treated as one by some browsers, and a scheme
 * of its own would leave this portal entirely.
 */
export function safeRedirectTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || !trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//') || trimmed.includes('\\')) return null;
  return trimmed;
}
