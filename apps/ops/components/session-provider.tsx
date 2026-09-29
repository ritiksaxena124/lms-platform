'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '@lms/shared';

import { onSessionLost, refreshSession } from '@/lib/api';
import { isSignedOutError, logIn, logOut } from '@/lib/auth';

export type SessionStatus = 'bootstrapping' | 'signed-in' | 'signed-out' | 'unreachable';

export interface SessionValue {
  status: SessionStatus;
  user: AuthUser | null;
  /** Resolves with the signed-in account; rejects with the API's `ApiError` for the form. */
  signIn(email: string, password: string): Promise<AuthUser>;
  /** Rejects if the API never heard the goodbye; the tab is signed out either way. */
  signOut(): Promise<void>;
  /** Tries the boot sequence again — the only recovery an `unreachable` status has. */
  retry(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}

/**
 * Who is signed in, for the whole tab.
 *
 * On boot it asks the API to trade the refresh cookie for a session, because the access token is
 * never stored anywhere the browser could keep it. Everything below that first answer is local state,
 * and a rejected refresh anywhere in the app is heard here rather than left in whichever component
 * happened to be calling.
 *
 * This holds the account, not the permission. Whether that account may stand in this portal is
 * `RequireSession`'s question, because the answer needs the chrome around it — a signed-out person
 * gets a redirect, and a signed-in teacher gets a door that says they are at the wrong desk.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('bootstrapping');
  const [user, setUser] = useState<AuthUser | null>(null);

  const bootstrap = useCallback(async () => {
    setStatus('bootstrapping');
    try {
      const session = await refreshSession();
      setUser(session?.user ?? null);
      setStatus(session?.user ? 'signed-in' : 'signed-out');
    } catch (error) {
      // A cookie the server already rejected can't be revived by trying again, so that one stays a
      // clean `signed-out`; anything else deserves the retry button.
      if (isSignedOutError(error)) {
        setUser(null);
        setStatus('signed-out');
        return;
      }
      setUser(null);
      setStatus('unreachable');
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(
    () =>
      onSessionLost(() => {
        setUser(null);
        setStatus('signed-out');
      }),
    [],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const account = await logIn(email, password);
    setUser(account);
    setStatus('signed-in');
    return account;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logOut();
    } finally {
      // Whatever the API said, this tab no longer has a session to act on.
      setUser(null);
      setStatus('signed-out');
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, user, signIn, signOut, retry: () => void bootstrap() }),
    [status, user, signIn, signOut, bootstrap],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
