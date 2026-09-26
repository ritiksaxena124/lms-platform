import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSessionResponse, AuthUser } from '@lms/shared';

import { apiJson, setAccessToken } from '@/lib/api';
import { SessionProvider, useSession } from './session-provider';

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

const UNAUTHORIZED = { statusCode: 401, code: 'UNAUTHORIZED', message: 'No session cookie' };

function sessionBody(accessToken: string): AuthSessionResponse {
  return { user: STUDENT, accessToken, tokenType: 'Bearer', expiresIn: 900 };
}

function json(status: number, body: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { status, ok: status < 400, text: async () => text };
}

/** Reads the context through the same hooks the portal's components use. */
function Probe({ onSession }: { onSession?: (value: ReturnType<typeof useSession>) => void }) {
  const value = useSession();
  onSession?.(value);

  return (
    <div>
      <span data-testid="status">{value.status}</span>
      <span data-testid="who">{value.user?.fullName ?? 'nobody'}</span>
      <button
        type="button"
        onClick={() => void value.signIn(STUDENT.email, 'lms-demo-password').catch(() => undefined)}
      >
        Sign in
      </button>
      <button type="button" onClick={() => void value.signOut().catch(() => undefined)}>
        Sign out
      </button>
      <button type="button" onClick={() => value.retry()}>
        Retry
      </button>
      <button
        type="button"
        onClick={() => void apiJson('/enrollments', { withSession: true }).catch(() => undefined)}
      >
        Check the roster
      </button>
    </div>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.localtest.me:4000';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderProvider() {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

function expectStatus(status: string) {
  return waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(status));
}

describe('SessionProvider', () => {
  it('starts signed in when the cookie still names someone', async () => {
    fetchMock.mockResolvedValueOnce(json(200, sessionBody('at-1')));
    renderProvider();

    await expectStatus('signed-in');
    expect(screen.getByTestId('who')).toHaveTextContent('Aditi Sharma');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.localtest.me:4000/api/v1/auth/refresh');
  });

  it('settles as signed out when there is no cookie to trade', async () => {
    fetchMock.mockResolvedValueOnce(json(401, UNAUTHORIZED));
    renderProvider();

    await expectStatus('signed-out');
    expect(screen.getByTestId('who')).toHaveTextContent('nobody');
  });

  it('names an unreachable API as its own state, and recovers on retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderProvider();
    await expectStatus('unreachable');

    fetchMock.mockResolvedValueOnce(json(200, sessionBody('at-2')));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await expectStatus('signed-in');
  });

  it('signs in without waiting for the next boot', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, UNAUTHORIZED))
      .mockResolvedValueOnce(json(200, sessionBody('at-3')));
    renderProvider();
    await expectStatus('signed-out');

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await expectStatus('signed-in');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://api.localtest.me:4000/api/v1/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('leaves locally even when the API never hears the goodbye', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, sessionBody('at-4')))
      .mockResolvedValueOnce(json(401, UNAUTHORIZED));
    renderProvider();
    await expectStatus('signed-in');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await expectStatus('signed-out');
    expect(screen.getByTestId('who')).toHaveTextContent('nobody');
  });

  it('notices a session that dies between two renders', async () => {
    const statuses: string[] = [];
    fetchMock.mockResolvedValueOnce(json(200, sessionBody('at-5')));
    render(
      <SessionProvider>
        <Probe
          onSession={(value) => {
            statuses.push(value.status);
          }}
        />
      </SessionProvider>,
    );
    await expectStatus('signed-in');

    fetchMock
      .mockResolvedValueOnce(
        json(401, { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Access token expired' }),
      )
      .mockResolvedValueOnce(json(401, UNAUTHORIZED));
    await userEvent.click(screen.getByRole('button', { name: 'Check the roster' }));

    await expectStatus('signed-out');
    expect(statuses.at(-1)).toBe('signed-out');
  });

  it('refuses to answer without a provider above it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Probe />)).toThrow(/SessionProvider/);

    consoleError.mockRestore();
  });
});
