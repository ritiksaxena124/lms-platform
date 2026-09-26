'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, PasswordField, TextField } from '@lms/ui';

import { describeFailure, fieldErrors } from '@/lib/api';
import { signUp } from '@/lib/auth';
import { useSession } from './session-provider';

/** Mirrors the server's floor, and only that one rule. */
const MIN_PASSWORD_LENGTH = 12;

export function SignUpForm() {
  const { signIn } = useSession();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFields({
        password: [
          `Use at least ${MIN_PASSWORD_LENGTH} characters — that is the minimum we accept.`,
        ],
      });
      setFormError(null);
      return;
    }

    setPending(true);
    setFields({});
    setFormError(null);

    try {
      await signUp({
        fullName,
        email,
        password,
        // This portal is the student portal: the role is never a form field, and an
        // account for anyone else has to be made where it belongs.
        role: 'student',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch (error) {
      const perField = fieldErrors(error);
      setFields(perField);
      if (Object.keys(perField).length === 0) setFormError(describeFailure(error));
      setPending(false);
      return;
    }

    try {
      await signIn(email, password);
      router.replace('/');
    } catch {
      // The account exists whatever this said, so the honest answer is the sign-in page
      // with a note — not a second form asking for the same password.
      router.replace('/login?notice=created');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      {formError ? (
        <p
          role="alert"
          className="rounded-field border border-danger-soft px-3 py-2 text-[0.8125rem] text-danger"
        >
          {formError}
        </p>
      ) : null}

      <TextField
        id="fullName"
        label="Full name"
        autoComplete="name"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        error={fields.fullName}
        disabled={pending}
        required
      />

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
        autoComplete="new-password"
        hint="At least 12 characters. Length beats symbols — a phrase you can remember is stronger than a rule you can not."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fields.password}
        disabled={pending}
        required
      />

      <Button type="submit" fullWidth loading={pending}>
        Create account
      </Button>

      <p className="text-[0.75rem] leading-snug text-ink-faint">
        You will be signed in as a student. Teaching happens on the teacher portal, and ops
        accounts are issued by the platform — neither is requested here.
      </p>
    </form>
  );
}
