import type { RoleCode } from './lookup-codes';

/**
 * The account as a portal is allowed to see it. Every date is already an ISO string:
 * these types cross the HTTP boundary in JSON, so a `Date` here would be a lie about
 * what the browser actually receives.
 */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleCode;
  status: string;
  timezone: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * What `/auth/login` and `/auth/refresh` answer with. The refresh token is absent on
 * purpose: it travels only as an `HttpOnly` cookie, so no portal can accidentally keep
 * it in a JavaScript-reachable place.
 */
export interface AuthSessionResponse {
  user: AuthUser;
  accessToken: string;
  tokenType: 'Bearer';
  /** Seconds until the access token dies; a portal refreshes inside this window. */
  expiresIn: number;
}

export interface AuthUserResponse {
  user: AuthUser;
}
