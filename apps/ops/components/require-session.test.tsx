import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, RoleCode } from '@lms/shared';

import { useSession } from './session-provider';
import { RequireSession, safeRedirectTarget } from './require-session';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/activity',
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
}));

vi.mock('./session-provider', () => ({ useSession: vi.fn() }));

/** The same account, twice, under two roles. Everything the ops portal is for lives in the
 * difference between these two renders. */
const account = (role: RoleCode): AuthUser => ({
  id: 'u1',
  email: `${role}@example.test`,
  fullName: role === 'ops' ? 'Ops Desk' : 'Aditi Sharma',
  role,
  status: 'active',
  timezone: 'Asia/Kolkata',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
});

function mockSession(status: string, user: AuthUser | null = null, retry = vi.fn()) {
  vi.mocked(useSession).mockReturnValue({
    status: status as ReturnType<typeof useSession>['status'],
    user,
    signIn: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    retry,
  });
  return retry;
}

beforeEach(() => {
  replace.mockReset();
});

describe('RequireSession on the ops desk', () => {
  it('holds the page back while the cookie is being traded', () => {
    mockSession('bootstrapping');

    render(
      <RequireSession>
        <p>The ledger</p>
      </RequireSession>,
    );

    expect(screen.queryByText('The ledger')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('sends an anonymous visitor to the sign-in page with the way back', async () => {
    mockSession('signed-out');

    render(
      <RequireSession>
        <p>The ledger</p>
      </RequireSession>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/activity')}`),
    );
    expect(screen.queryByText('The ledger')).not.toBeInTheDocument();
  });

  it('offers a retry when the API could not be reached', async () => {
    const retry = mockSession('unreachable');

    render(
      <RequireSession>
        <p>The ledger</p>
      </RequireSession>,
    );

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('The ledger')).not.toBeInTheDocument();
  });

  it('renders the page for an ops account', () => {
    mockSession('signed-in', account('ops'));

    render(
      <RequireSession>
        <p>The ledger</p>
      </RequireSession>,
    );

    expect(screen.getByText('The ledger')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * The half that makes this portal different from the other two.
   *
   * A teacher with a live session can reach these screens — the cookie is shared by every portal on
   * `localtest.me`, and a session that reads `/auth/me` happily is not the same thing as a session
   * that may read the ledger. The API answers that with a 403 on every route here, and this gate is
   * what stops the portal from assembling a page of empty tables to receive it with.
   *
   * It refuses in place rather than redirecting: sending the person to the sign-in page would put a
   * password box in front of somebody who is already signed in, and the way out of this portal is
   * the way out of any other.
   */
  it('refuses a session that belongs to another desk, without hiding who it belongs to', async () => {
    mockSession('signed-in', account('teacher'));

    render(
      <RequireSession>
        <p>The ledger</p>
      </RequireSession>,
    );

    expect(screen.queryByText('The ledger')).not.toBeInTheDocument();
    expect(screen.getByText(/Aditi Sharma/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(useSession().signOut).toHaveBeenCalled();
  });
});

describe('safeRedirectTarget', () => {
  it.each([
    ['/activity', '/activity'],
    ['/', '/'],
    ['/accounts?q=adi', '/accounts?q=adi'],
  ])('keeps the in-app path %s', (input, expected) => {
    expect(safeRedirectTarget(input)).toBe(expected);
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/activity',
    'javascript:alert(1)',
    'activity',
    '',
    '   ',
  ])('drops %r because it would leave this portal', (input) => {
    expect(safeRedirectTarget(input)).toBeNull();
  });

  it('drops a value that is not a string at all', () => {
    expect(safeRedirectTarget(undefined)).toBeNull();
  });
});
