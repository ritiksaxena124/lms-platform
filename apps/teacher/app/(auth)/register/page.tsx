import type { Metadata } from 'next';
import Link from 'next/link';

import { SignUpForm } from '@/components/sign-up-form';

export const metadata: Metadata = {
  title: 'Create a teacher account',
  description: 'Start teaching on the platform.',
};

export default function RegisterPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-h1 text-ink-strong">Create a teacher account</h1>
        <p className="mt-1 text-[0.9375rem] text-ink-muted">
          Two minutes now, then your profile is what students read.
        </p>
      </header>

      <SignUpForm />

      <p className="mt-6 border-t border-line pt-4 text-[0.8125rem] text-ink-muted">
        Already teaching here?{' '}
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
