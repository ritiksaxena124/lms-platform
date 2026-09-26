import type { Metadata } from 'next';
import Link from 'next/link';

import { SignInForm } from '@/components/sign-in-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the student portal.',
};

/**
 * `next` arrives untouched from the URL and is only ever followed after `safeRedirectTarget`
 * has proved it is a path inside this portal.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; notice?: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1 text-ink-strong">Sign in</h1>
        <p className="mt-1 text-[0.9375rem] text-ink-muted">
          Pick up the courses you are already inside.
        </p>
      </header>

      <SignInForm next={params.next ?? null} notice={params.notice ?? null} />

      <p className="mt-6 border-t border-line pt-4 text-[0.8125rem] text-ink-muted">
        Not learning here yet?{' '}
        <Link
          href="/register"
          className="text-brand-deep underline decoration-brand-line underline-offset-2 hover:decoration-brand"
        >
          Create a student account
        </Link>
      </p>

      <p className="mt-3 text-[0.8125rem] text-ink-faint">
        Or{' '}
        <Link href="/" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
          browse the shelf
        </Link>{' '}
        — it is open to anybody.
      </p>
    </>
  );
}
