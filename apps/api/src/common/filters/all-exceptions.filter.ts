import { ArgumentsHost, Catch, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode } from '@lms/shared';
import { API_ERROR_CODES, isApiErrorCode } from '@lms/shared';
import type { Request, Response } from 'express';

import { AppLogger } from '../logging/app-logger.service';
import { currentLogContext } from '../logging/log-context';

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: API_ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: API_ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: API_ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: API_ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: API_ERROR_CODES.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: API_ERROR_CODES.UNPROCESSABLE_ENTITY,
  [HttpStatus.TOO_MANY_REQUESTS]: API_ERROR_CODES.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: API_ERROR_CODES.SERVICE_UNAVAILABLE,
  [HttpStatus.INTERNAL_SERVER_ERROR]: API_ERROR_CODES.INTERNAL_ERROR,
};

/**
 * One shape for every failure: `{ statusCode, code, message, requestId }`. `code` is
 * stable and machine-readable; `message` is for humans. Unexpected errors report a
 * generic message while the real cause is logged with the request id, so a stack trace
 * or a connection string can never reach a client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(AppLogger) private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response =
      host.getType() !== 'http' ? undefined : host.switchToHttp().getResponse<Response>();
    const request =
      host.getType() !== 'http' ? undefined : host.switchToHttp().getRequest<Request>();
    if (!response || !request) return;

    const { statusCode, code, message, details } = describe(exception);
    const body: ApiErrorBody = {
      statusCode,
      code,
      message,
      requestId: request.requestId ?? currentLogContext().requestId,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('unhandled_exception', {
        module: 'Exceptions',
        path: request.path,
        method: request.method,
        requestId: body.requestId,
        error: exception instanceof Error ? exception.message : String(exception),
      });
    }

    void response.status(statusCode).json(body);
  }
}

function describe(exception: unknown): {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
} {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const providedCode =
      typeof payload === 'object' && payload !== null && 'code' in payload
        ? (payload as { code?: unknown }).code
        : undefined;

    // Validation pipes arrive as string arrays; collapse them into one readable message
    // and keep the field-level list for form rendering.
    if (Array.isArray(payload)) {
      const [message] = payload as unknown[];
      return {
        statusCode,
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: typeof message === 'string' ? message : 'Invalid request',
        details: { validation: payload },
      };
    }

    const objectPayload =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const validationErrors = Array.isArray(objectPayload.message)
      ? objectPayload.message
      : undefined;

    return {
      statusCode,
      code: isApiErrorCode(providedCode)
        ? providedCode
        : validationErrors
          ? API_ERROR_CODES.VALIDATION_FAILED
          : (CODE_BY_STATUS[statusCode] ?? API_ERROR_CODES.INTERNAL_ERROR),
      message:
        typeof objectPayload.message === 'string' ? objectPayload.message : exception.message,
      ...(validationErrors ? { details: { validation: validationErrors } } : {}),
    };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: API_ERROR_CODES.INTERNAL_ERROR,
    message: 'Something went wrong. Please try again.',
  };
}
