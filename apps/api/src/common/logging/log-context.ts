import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  requestId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, run: () => T): T {
  return storage.run(context, run);
}

export function currentLogContext(): LogContext {
  return storage.getStore() ?? {};
}
