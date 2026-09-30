/**
 * Stable, machine-readable API error codes. Frontends switch on these — never on
 * `message`, which is written for humans and may change.
 */
export const API_ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_ALREADY_TAKEN: 'EMAIL_ALREADY_TAKEN',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  INVALID_INPUT: 'INVALID_INPUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  requestId?: string;
  details?: unknown;
  timestamp?: string;
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === 'string' && Object.values(API_ERROR_CODES).includes(value as ApiErrorCode)
  );
}
