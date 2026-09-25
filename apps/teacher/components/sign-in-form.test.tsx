import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@lms/shared';

import { ApiError } from '@/lib/api';
import { SignInForm } from './sign-in-form';

const replace = vi.fn();
const signIn = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/login',
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

const TEACHER: AuthUser = {
  id: 'u1',
  email: 'teacher@example.test',
  fullName: 'Aditi Sharma',
  role: 'teacher',
  status: 'active',
  timezone: 'Asia/Kolkata',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

function validationError(): ApiError {
  return new ApiError({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'Check the highlighted fields.',
    details: { validation: { email: ['That is not an email address'] } },
  });
}

function credentialsError(): ApiError {
  return new ApiError({
    statusCode: 401,
    code: 'INVALID_CREDENTIALS',
    message: 'Email or password is not correct.',
    requestId: 'req-7',
  });
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'teacher@example.test');
  await userEvent.type(screen.getByLabelText('Password'), 'lms-demo-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  replace.mockReset();
  signIn.mockReset();
});

describe('SignInForm', () => {
  it('posts the credentials and lands inside the portal', async () => {
    signIn.mockResolvedValueOnce(TEACHER);
    render(<SignInForm />);

    await fillAndSubmit();

    expect(signIn).toHaveBeenCalledWith('teacher@example.test', 'lms-demo-password');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('goes back to the page the person was reaching for', async () => {
    signIn.mockResolvedValueOnce(TEACHER);
    render(<SignInForm next="/schedule" />);

    await fillAndSubmit();

    expect(replace).toHaveBeenCalledWith('/schedule');
  });

  it('will not be sent outside the portal by a hand-written next=', async () => {
    signIn.mockResolvedValueOnce(TEACHER);
    render(<SignInForm next="//evil.example/phish" />);

    await fillAndSubmit();

    expect(replace).toHaveBeenCalledWith('/');
  });

  it('puts each server message under the field it names', async () => {
    signIn.mockRejectedValueOnce(validationError());
    render(<SignInForm />);

    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText('That is not an email address')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Check the highlighted fields.')).not.toBeInTheDocument();
  });

  it('says the pair was wrong without saying which half', async () => {
    signIn.mockRejectedValueOnce(credentialsError());
    render(<SignInForm />);

    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Email or password is not correct.'),
    );
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
  });

  it('blocks the button for as long as the API is thinking', async () => {
    let finish!: (user: AuthUser) => void;
    signIn.mockReturnValueOnce(new Promise<AuthUser>((resolve) => (finish = resolve)));
    render(<SignInForm />);

    await fillAndSubmit();

    expect(screen.getByRole('button', { name: /sign in/i })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Email')).toBeDisabled();

    finish(TEACHER);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).not.toHaveAttribute('aria-busy'),
    );
  });

  it('trades typing for the seeded account when asked', async () => {
    signIn.mockResolvedValueOnce(TEACHER);
    render(<SignInForm />);

    await userEvent.click(screen.getByRole('button', { name: /demo teacher/i }));

    expect(screen.getByLabelText('Email')).toHaveValue('teacher@example.test');
    expect(screen.getByLabelText('Password')).toHaveValue('lms-demo-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('welcomes someone who has just registered', () => {
    render(<SignInForm notice="created" />);

    expect(screen.getByRole('status')).toHaveTextContent(/account created/i);
  });
});
