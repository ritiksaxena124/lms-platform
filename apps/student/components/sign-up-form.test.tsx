import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { signUp } from '@/lib/auth';
import { SignUpForm } from './sign-up-form';

vi.mock('@/lib/auth', () => ({ signUp: vi.fn() }));

const replace = vi.fn();
const signIn = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/register',
  useRouter: () => ({ replace }),
}));

vi.mock('./session-provider', () => ({
  useSession: () => ({
    status: 'signed-out',
    user: null,
    signIn,
    signOut: vi.fn(),
    retry: vi.fn(),
  }),
}));

const NEWBIE: AuthUser = {
  id: 'u2',
  email: 'new.student@example.test',
  fullName: 'New Student',
  role: 'student',
  status: 'active',
  timezone: 'Asia/Kolkata',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

async function fillForm() {
  await userEvent.type(screen.getByLabelText('Full name'), 'New Student');
  await userEvent.type(screen.getByLabelText('Email'), 'new.student@example.test');
  await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

beforeEach(() => {
  replace.mockReset();
  signIn.mockReset();
  vi.mocked(signUp).mockReset();
});

describe('SignUpForm', () => {
  it('asks for a student account in the browser’s own timezone', async () => {
    vi.mocked(signUp).mockResolvedValueOnce(NEWBIE);
    signIn.mockResolvedValueOnce(NEWBIE);
    render(<SignUpForm />);

    await fillForm();

    expect(signUp).toHaveBeenCalledWith({
      fullName: 'New Student',
      email: 'new.student@example.test',
      password: 'a-long-enough-password',
      role: 'student',
      timezone: expect.any(String),
    });
  });

  it('signs the account it just created in, instead of leaving it at the door', async () => {
    vi.mocked(signUp).mockResolvedValueOnce(NEWBIE);
    signIn.mockResolvedValueOnce(NEWBIE);
    render(<SignUpForm />);

    await fillForm();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(signIn).toHaveBeenCalledWith('new.student@example.test', 'a-long-enough-password');
  });

  it('keeps an account it could not sign in at the sign-in page', async () => {
    vi.mocked(signUp).mockResolvedValueOnce(NEWBIE);
    signIn.mockRejectedValueOnce(
      new ApiError({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'nope' }),
    );
    render(<SignUpForm />);

    await fillForm();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?notice=created'));
    expect(signUp).toHaveBeenCalledTimes(1);
  });

  it('reports a taken address against the field that caused it', async () => {
    vi.mocked(signUp).mockRejectedValueOnce(
      new ApiError({
        statusCode: 409,
        code: 'EMAIL_ALREADY_TAKEN',
        message: 'An account already uses this address.',
        details: { validation: { email: ['An account already uses this address.'] } },
      }),
    );
    render(<SignUpForm />);

    await fillForm();

    await waitFor(() =>
      expect(screen.getByText('An account already uses this address.')).toBeInTheDocument(),
    );
    expect(signIn).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('warns before the request that a password is too short to be accepted', async () => {
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText('Full name'), 'New Student');
    await userEvent.type(screen.getByLabelText('Email'), 'new.student@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(signUp).not.toHaveBeenCalled();
  });
});
