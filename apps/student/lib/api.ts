import { API_ERROR_CODES, type ApiErrorBody } from '@lms/shared';

/**
 * The transport the student portal calls through.
 *
 * It is deliberately smaller than the teacher portal's: every route this screen reads is
 * answered by the row's own status, so there is no token to hold, no cookie to send and
 * nothing to refresh when a request comes back `401`. That is also why no `credentials`
 * option appears here — a shared cached catalog page must not carry one stranger's session
 * to the next.
 *
 * What it keeps from its sibling is the shape of a failure: every problem leaves as an
 * `ApiError` carrying the server's envelope, because the UI switches on `code` while a
 * human reads `message`.
 */

/** Not an API code: the request never got an answer. Kept out of `API_ERROR_CODES` for that reason. */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

const API_PREFIX = '/api/v1';

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
    // Never the raw text: a gateway HTML page would become a wall of markup on screen.
    message: envelope?.message ?? `The request did not succeed (${status}).`,
    details: envelope?.details,
    requestId: envelope?.requestId ?? null,
  });
}

/**
 * One GET, one response body. `query` is whatever the caller built — this function does not
 * encode it, because the caller knows which of its values came from a typed input and which
 * a visitor typed.
 */
export async function apiGet<T>(path: string, query = ''): Promise<T> {
  const url = `${baseUrl()}${API_PREFIX}${path}${query}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError({
      statusCode: 0,
      code: NETWORK_ERROR_CODE,
      message: 'The catalog is unreachable. Check your connection and try again.',
    });
  }

  const payload = await parseBody(response);
  if (response.status >= 400) throw toApiError(response.status, payload);
  return payload as T;
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

/** A 404 is the catalog's answer to "not published" as much as to "not there". */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === API_ERROR_CODES.NOT_FOUND;
}
