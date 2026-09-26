import { API_ERROR_CODES } from '@lms/shared';
import type { AuthSessionResponse, AuthUser, RoleCode } from '@lms/shared';

import { ApiError, apiJson, setAccessToken } from './api';

/**
 * Everything the portal may ask of an account. Nothing here returns a token: `logIn`
 * stores it and hands back the person, which is all a caller can legitimately want.
 */

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  role: RoleCode;
  timezone?: string;
}

/** Registration never signs you in — the API issues no cookie for an unverified address. */
export async function signUp(input: SignUpInput): Promise<AuthUser> {
  const response = await apiJson<{ user: AuthUser }>('/auth/register', {
    method: 'POST',
    body: input,
    reviveSession: false,
  });
  return response.user;
}

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
    // A failed call still ends the local session: the token in this tab is useless once
    // the person has asked to leave, and the cookie expires on its own.
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
 * `INVALID_CREDENTIALS` is deliberately absent: that one belongs to the sign-in form, and
 * treating it as "signed out" would bounce someone who merely mistyped a password.
 */
export function isSignedOutError(error: unknown): boolean {
  return error instanceof ApiError && SIGNED_OUT_CODES.includes(error.code);
}
