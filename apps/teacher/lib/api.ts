import { API_ERROR_CODES, type ApiErrorBody, type AuthSessionResponse } from '@lms/shared';

/**
 * The transport every portal call goes through.
 *
 * Two rules shape it. The access token lives in a module variable, never in
 * `localStorage`, so it cannot outlive the tab that earned it; the session that revives
 * it lives in an `HttpOnly` cookie the browser sends on its own. And every failure leaves
 * as an `ApiError` carrying the server's envelope, because the UI switches on `code`
 * while a human reads `message`.
 */

/** Not an API code: the request never got an answer. Kept out of `API_ERROR_CODES` for that reason. */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

const API_PREFIX = '/api/v1';

const REFRESHABLE_CODES: readonly string[] = [
  API_ERROR_CODES.TOKEN_EXPIRED,
  API_ERROR_CODES.TOKEN_INVALID,
  // The client may hold no token at all — a reload onto a deep link. The cookie is what
  // decides, so this one 401 is worth a refresh like any other.
  API_ERROR_CODES.UNAUTHORIZED,
];

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(input: {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId ?? null;
  }
}

function baseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) {
    throw new ApiError({
      statusCode: 0,
      code: 'MISSING_API_URL',
      // A default here would point a deployed portal at a localhost API and fail as a
      // mystery "network error" in someone's browser.
      message: 'NEXT_PUBLIC_API_URL is not set, so this portal has no API to talk to.',
    });
  }
  return configured.replace(/\/+$/, '');
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

type SessionLostListener = () => void;
const sessionLostListeners = new Set<SessionLostListener>();

/**
 * Subscribes to "the session died under you". Returns the unsubscribe.
 *
 * A refresh can be refused while a page sits open — the cookie expired, an admin disabled
 * the account, a replay burned every session. Without this signal the header keeps greeting
 * a person who is already signed out.
 */
export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

function announceSessionLost(): void {
  accessToken = null;
  for (const listener of [...sessionLostListeners]) listener();
}

interface RawResponse {
  status: number;
  payload: unknown;
}

async function send(
  path: string,
  method: string,
  body: unknown,
  token: string | null,
): Promise<RawResponse> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  // Outside the `try` below: a missing configuration must not be reported as a network fault.
  const url = `${baseUrl()}${API_PREFIX}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError({
      statusCode: 0,
      code: NETWORK_ERROR_CODE,
      message: 'The API is unreachable. Check your connection and try again.',
    });
  }

  return { status: response.status, payload: await parseBody(response) };
}

/** A proxy page, an empty 204 and a truncated body all arrive here as `undefined`. */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isEnvelope(payload: unknown): payload is ApiErrorBody {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { code?: unknown }).code === 'string'
  );
}

function toApiError(status: number, payload: unknown): ApiError {
  const envelope = isEnvelope(payload) ? payload : undefined;
  return new ApiError({
    statusCode: envelope?.statusCode ?? status,
    code: envelope?.code ?? 'UNEXPECTED_RESPONSE',
    // Never `text`: a gateway HTML page would become a wall of markup in a toast.
    message: envelope?.message ?? `The request did not succeed (${status}).`,
    details: envelope?.details,
    requestId: envelope?.requestId ?? null,
  });
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Set to `false` on the credential endpoints. A 401 from them is the answer, not a
   * stale token: replaying one after a refresh would try the password twice, and replaying
   * a logout would put a session back after the person asked for it to end.
   */
  reviveSession?: boolean;
}

export async function apiJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const first = await send(path, method, options.body, accessToken);
  if (first.status < 400) return asData<T>(first.payload);

  const error = toApiError(first.status, first.payload);
  if (
    first.status !== 401 ||
    options.reviveSession === false ||
    !REFRESHABLE_CODES.includes(error.code)
  ) {
    throw error;
  }

  const revived = await refreshSession();
  if (!revived) {
    announceSessionLost();
    throw error;
  }

  const retry = await send(path, method, options.body, accessToken);
  if (retry.status >= 400) throw toApiError(retry.status, retry.payload);
  return asData<T>(retry.payload);
}

function asData<T>(payload: unknown): T {
  return payload as T;
}

let refreshCall: Promise<AuthSessionResponse | null> | null = null;

/**
 * Trades the refresh cookie for a live session, and resolves to `null` when there is
 * nothing to trade — no cookie, or one the API refused.
 *
 * Concurrent callers share one request: a portal that boots three widgets must not burn
 * the refresh token three times, since the API treats a reused token as a theft and ends
 * every session it knows about.
 */
export function refreshSession(): Promise<AuthSessionResponse | null> {
  refreshCall ??= performRefresh().finally(() => {
    refreshCall = null;
  });
  return refreshCall;
}

async function performRefresh(): Promise<AuthSessionResponse | null> {
  const response = await send('/auth/refresh', 'POST', undefined, null);
  if (response.status >= 400) return null;
  const session = response.payload as AuthSessionResponse | undefined;
  if (!session?.accessToken) return null;
  accessToken = session.accessToken;
  return session;
}

/** Field-keyed messages from a `VALIDATION_FAILED` envelope, ready for a form's errors. */
export function fieldErrors(error: unknown): Record<string, string[]> {
  if (!(error instanceof ApiError)) return {};
  const validation = (error.details as { validation?: unknown } | undefined)?.validation;
  if (!validation || typeof validation !== 'object') return {};

  const collected: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(validation as Record<string, unknown>)) {
    collected[field] = (Array.isArray(value) ? value : [value]).map((line) => String(line));
  }
  return collected;
}

/**
 * One readable line for anything the API threw, for a form that has nowhere else to put it.
 *
 * Field-keyed messages go through `fieldErrors` instead; this is the fallback, so it must
 * never be blank and must never be a stack.
 */
export function describeFailure(error: unknown): string {
  const message =
    error instanceof ApiError || error instanceof Error ? error.message : String(error ?? '');
  return message.trim() === '' ? 'Something went wrong. Please try again.' : message.trim();
}
