import { API_ERROR_CODES } from '@lms/shared';
import type { AuthSessionResponse, AuthUser } from '@lms/shared';

import { ApiError, apiJson, setAccessToken } from './api';

/**
 * Everything this portal may ask of an account.
 *
 * There is no sign-up. `ops` is not on the registration form's list of roles a stranger may choose,
 * and an operator account is issued by another operator through `/api/v1/users/:id/role` — so a
 * portal that offered to make one would be a form that always fails, and the only account that could
 * ever fill it in successfully would be the one already signed in.
 *
 * Nothing here returns a token: `logIn` stores it and hands back the person, which is all a caller
 * can legitimately want.
 */

export async function logIn(email: string, password: string): Promise<AuthUser> {
  const session = await apiJson<AuthSessionResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    // A wrong password is an answer, not a stale token.
    reviveSession: false,
  });
  setAccessToken(session.accessToken);
  return session.user;
}

export async function logOut(): Promise<void> {
  try {
    await apiJson<void>('/auth/logout', { method: 'POST', reviveSession: false });
  } finally {
    // A failed call still ends the local session: the token in this tab is useless once the person
    // has asked to leave, and the cookie expires on its own.
    setAccessToken(null);
  }
}

const SIGNED_OUT_CODES: readonly string[] = [
  API_ERROR_CODES.UNAUTHORIZED,
  API_ERROR_CODES.TOKEN_EXPIRED,
  API_ERROR_CODES.TOKEN_INVALID,
  API_ERROR_CODES.ACCOUNT_DISABLED,
];

/**
 * True when a call failed because this account is no longer entitled to a session.
 *
 * `INVALID_CREDENTIALS` is deliberately absent: that one belongs to the sign-in form, and treating it
 * as "signed out" would bounce someone who merely mistyped a password. `FORBIDDEN` is absent too, and
 * for the opposite reason — a 403 here means the session is alive and is not ops, which is a different
 * screen and a different way out.
 */
export function isSignedOutError(error: unknown): boolean {
  return error instanceof ApiError && SIGNED_OUT_CODES.includes(error.code);
}
