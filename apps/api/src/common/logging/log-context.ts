import { AsyncLocalStorage } from 'node:async_hooks';
import type { RoleCode } from '@lms/shared';

export interface LogContext {
  requestId?: string;
  userId?: string;
  /** The role as `JwtAuthGuard` resolved it from the account, not as the access token claimed it —
   * the same distinction Phase 7's record keeps in `actor_role_code`. Read by the recorder rather
   * than by the logger: an account's role on every log line is a detail whoever reads the log
   * should have to ask for, and the column that holds it is the place it is meant to be. */
  userRole?: RoleCode;
}

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, run: () => T): T {
  return storage.run(context, run);
}

export function currentLogContext(): LogContext {
  return storage.getStore() ?? {};
}

/**
 * Binds the signed-in person to everything still running for this request.
 *
 * The guard resolves the account after the middleware opened the context, and there is no way to
 * re-enter it from there — the handler is already running inside the `run` the middleware passed to
 * `storage.run`. So the store is filled in place, which is safe precisely because of who owns it:
 * the object is created per request by `createRequestContextMiddleware`, so nothing concurrent can
 * observe the write, and everything downstream in this request's async chain already shares it.
 *
 * A no-op when there is no context at all — a cron, or a spec constructing a guard by hand. That is
 * an answer rather than a loss: `ActionRecorder` treats a missing actor as a reason to refuse a
 * person's action, and a scheduler's actions are the ones legitimately taken by nobody.
 */
export function identifyInLogContext(actor: { userId: string; userRole: RoleCode }): void {
  const context = storage.getStore();
  if (context) Object.assign(context, actor);
}
