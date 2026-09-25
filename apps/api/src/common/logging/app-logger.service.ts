import type { LoggerService as NestLoggerService } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { isRedactedKey } from '../../config/env';
import { currentLogContext, runWithLogContext } from './log-context';

export type LogLevel = 'debug' | 'log' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

/**
 * Structured single-line JSON logs, with a readable mode for local development.
 * Secrets are removed here rather than at each call site, so a developer cannot
 * accidentally log a password by passing the object that holds it.
 */
@Injectable()
export class AppLogger implements NestLoggerService {
  private context = 'App';

  setContext(context: string): void {
    this.context = context;
  }

  debug(message: string, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  log(message: string, ...params: unknown[]): void {
    this.emit('log', message, params);
  }

  warn(message: string, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  error(message: string | Error, ...params: unknown[]): void {
    const error = typeof message === 'string' ? undefined : message;
    const { module, fields } = collectParams(params, this.context);
    this.write(
      'error',
      typeof message === 'string' ? message : message.message,
      {
        ...fields,
        ...(error
          ? {
              stack: redact(error.stack ?? '')
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            }
          : {}),
      },
      module,
    );
  }

  private emit(level: LogLevel, message: string, params: unknown[]): void {
    const collected = collectParams(params, this.context);
    this.write(level, message, collected.fields, collected.module);
  }

  /** Logs one handled HTTP request: enough to correlate a slow or failing call. */
  request(req: Request, statusCode: number, durationMs: number): void {
    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log';
    this.write(
      level,
      'request',
      {
        method: req.method,
        path: req.path,
        statusCode,
        durationMs: Math.round(durationMs),
      },
      'Http',
    );
  }

  /** Binds request/user identity for the duration of `run` without parameter threading. */
  withContext<T>(context: LogContextForBinding, run: () => T): T {
    return runWithLogContext(context, run);
  }

  private write(level: LogLevel, message: string, fields: LogFields, module = this.context): void {
    const context = currentLogContext();
    const line = buildLogLine({
      level,
      message,
      module,
      requestId: context.requestId,
      userId: context.userId,
      ...fields,
    });

    if (process.env.NODE_ENV === 'test') return;
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `${level.toUpperCase().padEnd(5)} ${line.module ?? ''} ${line.msg}` +
          restOfLine(line, ['time', 'level', 'msg', 'module']),
      );
      return;
    }

    console.log(JSON.stringify(line));
  }
}

/**
 * Nest calls the logger as `log(message, ...optionalParams)`, where a string parameter
 * is the caller's context (e.g. `HealthController`). Objects passed by our own call
 * sites are merged as structured fields. Without this, Nest's internal calls spread a
 * string into an object position and produced `{"0":"H","1":"e",...}` noise.
 */
export function collectParams(
  params: unknown[],
  fallbackModule: string,
): { module: string; fields: LogFields } {
  const fields: LogFields = {};
  let module = fallbackModule;

  for (const param of params) {
    if (typeof param === 'string') {
      module = param;
    } else if (param && typeof param === 'object') {
      Object.assign(fields, param);
    }
  }
  return { module, fields };
}

function restOfLine(line: StructuredLine, skip: string[]): string {
  const extras = Object.fromEntries(
    Object.entries(line).filter(([key, value]) => !skip.includes(key) && value !== undefined),
  );
  return Object.keys(extras).length > 0 ? ` ${JSON.stringify(extras)}` : '';
}

type LogContextForBinding = { requestId?: string; userId?: string };

export interface StructuredLine {
  time: string;
  level: LogLevel;
  msg: string;
  module?: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

export function buildLogLine(
  input: LogFields & { level: LogLevel; message: string },
): StructuredLine {
  const { level, message, ...rest } = input;
  return {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...sanitize(rest),
  } as StructuredLine;
}

const REDACTED = '[redacted]';

export function sanitize(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 6 || value === null || typeof value !== 'object') return {};
  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isRedactedKey(key)) {
      output[key] = REDACTED;
      continue;
    }
    if (entry instanceof Error) {
      output[key] = { name: entry.name, message: redact(entry.message) };
    } else if (Array.isArray(entry)) {
      output[key] = entry.map((item) =>
        item && typeof item === 'object' ? sanitize(item, depth + 1) : item,
      );
    } else if (entry && typeof entry === 'object') {
      output[key] = sanitize(entry, depth + 1);
    } else {
      output[key] = entry;
    }
  }
  return output;
}

function redact(text: string): string {
  return text.replace(
    /(password|token|secret)=\S+/gi,
    (_match, key: string) => `${key}=${REDACTED}`,
  );
}
