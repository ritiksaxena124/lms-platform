import { API_ERROR_CODES, type ApiErrorBody, type AuthSessionResponse } from '@lms/shared';

/**
 * The transport every student portal call goes through.
 *
 * Two rules shape it, and they pull in opposite directions. The catalog's shelf is the one
 * surface on this app that answers a stranger and a member identically, so a request for it
 * carries nothing that could make it the second visitor's page — no token, no cookies, exactly
 * as before this portal knew what a session was. And a course's outline, one of its pages and
 * the roster routes do answer for whoever is asking, so those calls carry the session and can
 * be revived when it has gone stale. `withSession` is the line between the two, and it is set
 * per call rather than per portal so that the first rule cannot rot into the second by accident.
 *
 * Where a session lives: the access token is a module variable, never `localStorage`, so it
 * cannot outlive the tab that earned it, and the session that revives it is an `HttpOnly`
 * cookie the browser sends on its own.
 *
 * Every failure leaves as an `ApiError` carrying the server's envelope, because the UI switches
 * on `code` while a human reads `message`.
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
 * A refresh can be refused while a page sits open — the cookie expired, an account was
 * disabled, a replayed token burned every session it knows about. Without this signal the
 * header keeps greeting a person who is already signed out, and the outline keeps showing the
 * doors their place opened.
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

interface SendOptions {
  /** The bearer token to offer, or `null` for none. */
  token: string | null;
  /** Whether the browser should send the refresh cookie along. It goes without a token too:
   * a reload onto a deep link holds the cookie and none of the token, and the cookie is what
   * the refresh endpoint reads. */
  cookies: boolean;
}

async function send(
  path: string,
  method: string,
  body: unknown,
  options: SendOptions,
  accept = 'application/json',
): Promise<Response> {
  const headers: Record<string, string> = { accept };
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Absent rather than `Bearer null`: a call with no token is a stranger's call, and the
  // routes that read one treat a broken header as a refusal rather than an absence.
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  // Outside the `try` below: a missing configuration must not be reported as a network fault.
  const url = `${baseUrl()}${API_PREFIX}${path}`;

  try {
    return await fetch(url, {
      method,
      headers,
      // Only a call that asked for the session sends cookies, so a shelf request cannot
      // become a cached page that answers as somebody else.
      ...(options.cookies ? { credentials: 'include' as RequestCredentials } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
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
    // Never the raw body: a gateway HTML page would become a wall of markup on screen. The byte
    // routes answer a refusal with this same envelope, so reading it is what lets a player tell
    // "no recording" from "not your page".
    message: envelope?.message ?? `The request did not succeed (${response.status}).`,
    details: envelope?.details,
    requestId: envelope?.requestId ?? null,
  });
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Send this call's session — the token if the tab holds one, and the cookie either way —
   * and revive it if the API says it has gone stale. Set it on the routes that answer for
   * whoever is asking: a course's outline, one of its pages, the roster, and the credential
   * endpoints. Leave it off the shelf, which is the same list for everybody.
   */
  withSession?: boolean;
  /**
   * Set to `false` on the credential endpoints. A 401 from them is the answer, not a stale
   * token: replaying a login would try the password twice, and replaying a logout would put a
   * session back after the person asked for it to end.
   */
  reviveSession?: boolean;
}

/**
 * Send, and if the answer is a dead session send once more with a revived one.
 *
 * `read` is the only thing that differs between the shapes a call can come back in, which is why
 * it is a parameter rather than a second function: a JSON reply, a blob of a recording and a
 * thrown envelope all need the same replay, and a second copy of this loop is how a refresh ends
 * up half-implemented for the requests nobody thought about twice.
 */
async function request<T>(
  path: string,
  options: ApiRequestOptions,
  method: string,
  read: (response: Response) => Promise<T>,
  accept = 'application/json',
): Promise<T> {
  const withSession = options.withSession === true;
  const session: SendOptions = { token: withSession ? accessToken : null, cookies: withSession };
  const first = await send(path, method, options.body, session, accept);
  if (first.status < 400) return read(first);

  const error = await toApiError(first);
  if (
    !withSession ||
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

  const retry = await send(
    path,
    method,
    options.body,
    { token: accessToken, cookies: true },
    accept,
  );
  if (retry.status >= 400) throw await toApiError(retry);
  return read(retry);
}

const asJson = async <T>(response: Response): Promise<T> => (await parseBody(response)) as T;

/** A call that names its own method and body. */
export function apiJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return request<T>(path, options, options.method ?? 'GET', asJson<T>);
}

/**
 * One GET. `query` is whatever the caller built — this function does not encode it, because the
 * caller knows which of its values came from a typed input and which a visitor typed.
 */
export function apiGet<T>(
  path: string,
  query = '',
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
): Promise<T> {
  return request<T>(`${path}${query}`, options, 'GET', asJson<T>);
}

/**
 * Bytes from a gated route, as a Blob — the shape a lesson's recording arrives in.
 *
 * There is no link to these bytes anywhere on this platform: a page says a recording exists and
 * says how big it is, and this is the only way to get the file. That is deliberate (a URL would
 * work without a session and stand as a second door around the first), but it means the player
 * cannot be handed an address — so the portal reads the whole thing here, holds it as an object
 * URL, and gives `<video>` that instead. The file lives in memory rather than being proxied,
 * which is also what lets a student scrub through a lesson without another request.
 *
 * The session is always sent, because a recording is either a page's free preview or the part
 * somebody enrolled for, and a token never hurts the first.
 */
export function apiBytes(path: string): Promise<Blob> {
  return request<Blob>(path, { withSession: true }, 'GET', (response) => response.blob(), '*/*');
}

let refreshCall: Promise<AuthSessionResponse | null> | null = null;

/**
 * Trades the refresh cookie for a live session, and resolves to `null` when there is nothing to
 * trade — no cookie, or one the API refused.
 *
 * Concurrent callers share one request: a portal that opens an outline and a page at once must
 * not burn the refresh token twice, since the API treats a reused token as a theft and ends
 * every session it knows about.
 */
export function refreshSession(): Promise<AuthSessionResponse | null> {
  refreshCall ??= performRefresh().finally(() => {
    refreshCall = null;
  });
  return refreshCall;
}

async function performRefresh(): Promise<AuthSessionResponse | null> {
  const response = await send('/auth/refresh', 'POST', undefined, {
    token: null,
    cookies: true,
  });
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
 * One readable line for anything the API threw, for a screen that has nowhere else to put it.
 *
 * Field-keyed messages go through `fieldErrors` instead; this is the fallback, so it must
 * never be blank and must never be a stack.
 */
export function describeFailure(error: unknown): string {
  const message =
    error instanceof ApiError || error instanceof Error ? error.message : String(error ?? '');
  return message.trim() === '' ? 'Something went wrong. Please try again.' : message.trim();
}

/** True when the request never got an answer, rather than an answer that refused.
 * The difference is what a reader can act on: a 500 wants a retry, while no answer at all
 * usually means this page was opened on an address that has no API behind it. */
export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.code === NETWORK_ERROR_CODE;
}

/** A 404 is the catalog's answer to "not published" as much as to "not there". */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === API_ERROR_CODES.NOT_FOUND;
}

/**
 * True when the session is live but this account is not allowed to ask.
 *
 * On this portal that has one common cause: a cookie earned at a teacher's or the ops desk's
 * sign-in, which the shared session lets a student tab hold. It is not a stale token (a refresh
 * answers the same 403), not a refused place, and not a connection that has not come back, so
 * the three read differently on screen.
 */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.code === API_ERROR_CODES.FORBIDDEN;
}

/**
 * What to say when a 403 turns up. The API's line is true and useless — "This account is not
 * allowed to do that." does not name the account that would work, which is the only thing the
 * reader can act on. Names no address and no password, because this reaches a browser.
 */
export const NOT_A_LEARNER_MESSAGE =
  'This session is not a learner account, so it cannot hold a place. Sign in as a learner to read on.';
