import type { Metadata } from 'next';
import Link from 'next/link';

import { SignUpForm } from '@/components/sign-up-form';

export const metadata: Metadata = {
  title: 'Create a student account',
  description: 'Hold a place in a course and read what it opens.',
};

export default function RegisterPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1 text-ink-strong">Create a student account</h1>
        <p className="mt-1 text-[0.9375rem] text-ink-muted">
          One account, and a course’s outline turns from a list of titles into pages you can
          open.
        </p>
      </header>

      <SignUpForm />

      <p className="mt-6 border-t border-line pt-4 text-[0.8125rem] text-ink-muted">
        Already learning here?{' '}
        <Link
          href="/login"
          className="text-brand-deep underline decoration-brand-line underline-offset-2 hover:decoration-brand"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
