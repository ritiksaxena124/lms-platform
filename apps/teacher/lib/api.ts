import { API_ERROR_CODES, type ApiErrorBody, type AuthSessionResponse } from '@lms/shared';

/**
 * The transport every portal call goes through.
 *
 * Two rules shape it. The access token lives in a module variable, never in
 * `localStorage`, so it cannot outlive the tab that earned it; the session that revives
 * it lives in an `HttpOnly` cookie the browser sends on its own. And every failure leaves
 * as an `ApiError` carrying the server's envelope, because the UI switches on `code`
 * while a human reads `message`.
 *
 * Three shapes go through it — `apiJson` for an object, `apiForm` for a file, `apiBytes` for
 * the bytes back — because a recording arrives as bytes and a `<video>` tag cannot carry the
 * token that authorizes them. All three share the refresh-and-replay step below.
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

/**
 * What a request carries, already shaped for `fetch`.
 *
 * `json` is the whole point of the pair rather than a description of the body: a form must leave
 * its `content-type` to the browser, which is the only thing that knows the multipart boundary.
 */
interface Outgoing {
  body: BodyInit | undefined;
  json: boolean;
}

function jsonBody(value: unknown): Outgoing {
  return {
    body: value === undefined ? undefined : JSON.stringify(value),
    json: value !== undefined,
  };
}

async function attempt(
  path: string,
  method: string,
  outgoing: Outgoing | undefined,
  token: string | null,
  accept = 'application/json',
): Promise<Response> {
  const headers: Record<string, string> = { accept };
  if (outgoing?.json) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  // Outside the `try` below: a missing configuration must not be reported as a network fault.
  const url = `${baseUrl()}${API_PREFIX}${path}`;

  try {
    return await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: outgoing?.body,
    });
  } catch {
    throw new ApiError({
      statusCode: 0,
      code: NETWORK_ERROR_CODE,
      message: 'The API is unreachable. Check your connection and try again.',
    });
  }
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

async function toApiError(response: Response): Promise<ApiError> {
  const payload = await parseBody(response);
  const envelope = isEnvelope(payload) ? payload : undefined;
  return new ApiError({
    statusCode: envelope?.statusCode ?? response.status,
    code: envelope?.code ?? 'UNEXPECTED_RESPONSE',
    // Never the raw body: a gateway HTML page would become a wall of markup in a toast.
    message: envelope?.message ?? `The request did not succeed (${response.status}).`,
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

/**
 * Send, and if the answer is a dead token send once more with a revived session.
 *
 * `read` is the only thing that differs between the shapes of request, which is why it is a
 * parameter: a JSON reply, a blob of bytes and a thrown envelope all need the same replay, and
 * a second copy of this loop is how a refresh would end up half-implemented for video bytes.
 */
async function request<T>(
  path: string,
  method: string,
  outgoing: Outgoing | undefined,
  revive: boolean,
  read: (response: Response) => Promise<T>,
  accept = 'application/json',
): Promise<T> {
  const first = await attempt(path, method, outgoing, accessToken, accept);
  if (first.status < 400) return read(first);

  const error = await toApiError(first);
  if (first.status !== 401 || !revive || !REFRESHABLE_CODES.includes(error.code)) throw error;

  const revived = await refreshSession();
  if (!revived) {
    announceSessionLost();
    throw error;
  }

  const retry = await attempt(path, method, outgoing, accessToken, accept);
  if (retry.status >= 400) throw await toApiError(retry);
  return read(retry);
}

const asJson = async <T>(response: Response): Promise<T> => asData<T>(await parseBody(response));

export async function apiJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return request(
    path,
    options.method ?? 'GET',
    jsonBody(options.body),
    options.reviveSession !== false,
    asJson<T>,
  );
}

/**
 * Post a `FormData` — the shape a file upload needs.
 *
 * `content-type` stays unset on purpose. The multipart boundary is generated by the browser
 * from the exact form it hands over, so any value here would make the API read a body with no
 * file in it.
 */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  return request(path, 'POST', { body: form, json: false }, true, asJson<T>);
}

/**
 * Bytes from an authorized route, as a Blob.
 *
 * A recording is served to a bearer token, and a `<video src>` cannot send one — so the portal
 * reads the bytes here and gives the player an object URL instead. The whole file is held in
 * memory rather than proxied, which is what lets the browser seek inside it freely.
 */
export async function apiBytes(path: string): Promise<Blob> {
  return request(path, 'GET', undefined, true, (response) => response.blob(), '*/*');
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
  const response = await attempt('/auth/refresh', 'POST', undefined, null);
  if (response.status >= 400) return null;
  const session = (await parseBody(response)) as AuthSessionResponse | undefined;
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
