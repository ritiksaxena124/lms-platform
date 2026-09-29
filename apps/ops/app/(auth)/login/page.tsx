import type { Metadata } from 'next';

import { SignInForm } from '@/components/sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the ops desk.',
};

/**
 * `next` arrives untouched from the URL and is only ever followed after `safeRedirectTarget` has
 * proved it is a path inside this portal.
 *
 * There is deliberately no link to a registration screen: the ops role is issued from inside the
 * desk, by an account that already holds it, so the first operator is the seed and every one after
 * them is a promotion on the accounts page.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1 text-ink-strong">Sign in</h1>
        <p className="mt-1 text-[0.9375rem] text-ink-muted">
          The desk reads the ledger, the accounts and the queue.
        </p>
      </header>

      <SignInForm next={params.next ?? null} />
    </>
  );
}
