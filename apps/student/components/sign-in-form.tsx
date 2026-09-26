'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, PasswordField, TextField } from '@lms/ui';

import { describeFailure, fieldErrors } from '@/lib/api';
import { useSession } from './session-provider';
import { safeRedirectTarget } from './require-session';

/** The seeded account from the README, offered so a demo needs no clipboard. */
const DEMO = { email: 'student@example.test', password: 'lms-demo-password' } as const;

export interface SignInFormProps {
  /** The raw `?next=` from the URL: only honoured if it stays inside this portal. */
  next?: string | null;
  /** A one-off note from another screen, e.g. `created` after registration. */
  notice?: string | null;
}

export function SignInForm({ next, notice }: SignInFormProps) {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFields({});
    setFormError(null);

    try {
      await signIn(email, password);
      router.replace(safeRedirectTarget(next) ?? '/');
    } catch (error) {
      const perField = fieldErrors(error);
      setFields(perField);
      // A form-level line only when no field can be blamed for it.
      if (Object.keys(perField).length === 0) setFormError(describeFailure(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      {notice === 'created' ? (
        <p
          role="status"
          className="rounded-field border border-success-soft bg-success-soft/60 px-3 py-2 text-[0.8125rem] text-ink"
        >
          Account created. Sign in to open your portal.
        </p>
      ) : null}

      {formError ? (
        <p
          role="alert"
          className="rounded-field border border-danger-soft px-3 py-2 text-[0.8125rem] text-danger"
        >
          {formError}
        </p>
      ) : null}

      <TextField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fields.email}
        disabled={pending}
        required
      />

      <PasswordField
        id="password"
        label="Password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fields.password}
        disabled={pending}
        required
      />

      <Button type="submit" fullWidth loading={pending}>
        Sign in
      </Button>

      <button
        type="button"
        onClick={() => {
          setEmail(DEMO.email);
          setPassword(DEMO.password);
        }}
        className="self-start text-[0.8125rem] text-ink-faint underline decoration-line-strong underline-offset-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-ink"
      >
        Fill the demo student account
      </button>
    </form>
  );
}
