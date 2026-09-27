import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@lms/shared';

import { SiteAccount } from './site-account';

const SAM: AuthUser = {
  id: 'u1',
  email: 'sam@example.test',
  fullName: 'Sam Iyer',
  role: 'student',
  status: 'active',
  timezone: 'Asia/Kolkata',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

const useSession = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('./session-provider', () => ({ useSession }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

function linkedRoutes(href: string): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`));
}

/**
 * The header's account corner, and the reason it owns one decision rather than two: where a
 * signed-out person belongs is the `Sign in` link's answer, and what a member can reach is their
 * two lists — the courses they hold a place in and the classes on their calendar. No screen
 * redirects from here — `RequireSession` does that where it gates.
 */
describe('SiteAccount', () => {
  it('offers a stranger the door that opens the rest', () => {
    useSession.mockReturnValue({ status: 'signed-out', user: null, signOut });

    render(<SiteAccount />);

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: /my courses/i })).not.toBeInTheDocument();
  });

  it('shows a member their name, their courses and the way out', async () => {
    signOut.mockResolvedValue(undefined);
    useSession.mockReturnValue({ status: 'signed-in', user: SAM, signOut });

    render(<SiteAccount />);

    expect(screen.getByText('Sam Iyer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /my courses/i })).toHaveAttribute(
      'href',
      '/my-courses',
    );
    // A place in a course and a class on a calendar are two different things to catch up on, and
    // a member should not have to reach one through the other.
    expect(screen.getByRole('link', { name: /my classes/i })).toHaveAttribute('href', '/my-classes');
    // The way out is a button, not a link: it ends a session rather than opening a page.
    expect(linkedRoutes('/login')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
    await vi.waitFor(() => expect(notify.success).toHaveBeenCalledWith('Signed out'));
  });

  it('holds the space open while the bootstrapping read is in flight', () => {
    useSession.mockReturnValue({ status: 'bootstrapping', user: null, signOut });

    render(<SiteAccount />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Checking whether you are signed in')).toBeInTheDocument();
  });

  it('says nothing about a session it could not check', () => {
    useSession.mockReturnValue({ status: 'unreachable', user: null, signOut });

    render(<SiteAccount />);

    // A `Sign in` link here would promise a form that cannot reach the API either, and the
    // screens below carry their own retry.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
