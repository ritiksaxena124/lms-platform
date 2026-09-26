import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@lms/shared';

import { useSession } from './session-provider';
import { RequireSession, safeRedirectTarget } from './require-session';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/schedule',
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
}));

vi.mock('./session-provider', () => ({ useSession: vi.fn() }));

const STUDENT: AuthUser = {
  id: 'u1',
  email: 'student@example.test',
  fullName: 'Aditi Sharma',
  role: 'student',
  status: 'active',
  timezone: 'Asia/Kolkata',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

function mockSession(status: string, retry = vi.fn()) {
  vi.mocked(useSession).mockReturnValue({
    status: status as ReturnType<typeof useSession>['status'],
    user: status === 'signed-in' ? STUDENT : null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry,
  });
  return retry;
}

beforeEach(() => {
  replace.mockReset();
});

describe('RequireSession', () => {
  it('holds the page back while the cookie is being traded', () => {
    mockSession('bootstrapping');

    render(
      <RequireSession>
        <p>Private schedule</p>
      </RequireSession>,
    );

    expect(screen.queryByText('Private schedule')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('sends an anonymous visitor to the sign-in page with the way back', async () => {
    mockSession('signed-out');

    render(
      <RequireSession>
        <p>Private schedule</p>
      </RequireSession>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/schedule')}`),
    );
    expect(screen.queryByText('Private schedule')).not.toBeInTheDocument();
  });

  it('offers a retry when the API could not be reached', async () => {
    const retry = mockSession('unreachable');

    render(
      <RequireSession>
        <p>Private schedule</p>
      </RequireSession>,
    );

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Private schedule')).not.toBeInTheDocument();
  });

  it('renders the page once there is a session', () => {
    mockSession('signed-in');

    render(
      <RequireSession>
        <p>Private schedule</p>
      </RequireSession>,
    );

    expect(screen.getByText('Private schedule')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('safeRedirectTarget', () => {
  it.each([
    ['/schedule', '/schedule'],
    ['/', '/'],
    ['/course/42?tab=lessons', '/course/42?tab=lessons'],
  ])('keeps the in-app path %s', (input, expected) => {
    expect(safeRedirectTarget(input)).toBe(expected);
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/schedule',
    'javascript:alert(1)',
    'schedule',
    '',
    '   ',
  ])('drops %r because it would leave this portal', (input) => {
    expect(safeRedirectTarget(input)).toBeNull();
  });

  it('drops a value that is not a string at all', () => {
    expect(safeRedirectTarget(undefined)).toBeNull();
  });
});
