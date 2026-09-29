import 'reflect-metadata';

import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';

import { API_PREFIX } from '../common/http/api-prefix';
import { AppModule } from '../app.module';
import { IS_PUBLIC } from '../modules/auth/public.decorator';
import { OPTIONAL_SESSION } from '../modules/auth/optional-session.decorator';
import { REQUIRED_ROLES } from '../modules/auth/roles.decorator';

/** What a caller has to bring, as `JwtAuthGuard` and `RolesGuard` actually decide it. */
export interface EndpointAccess {
  /**
   * `public` ignores the session header; `optional-session` reads one if it arrives and asks for
   * nothing if it does not; `session` refuses the call without it. The order is the guard's own —
   * it tests the optional flag first, which is why an optional route never also says it is public.
   */
  kind: 'public' | 'optional-session' | 'session';
  /** Roles the route names. Empty means any signed-in account, or any caller at all when public. */
  roles: string[];
}

export interface EndpointRecord {
  method: string;
  /** Includes the public prefix, because that is the string a reader has to send. */
  path: string;
  /** What a successful call answers with — `@HttpCode`, or the default Nest picks. */
  statusCode: number;
  access: EndpointAccess;
  /** Where the route lives, so a reader who wants the rules behind it can find the file. */
  controller: string;
  handler: string;
}

/** A controller class, seen only through the metadata hung on it. */
interface ClassRef {
  name: string;
  prototype: Record<string, unknown>;
}

function readMeta<T>(key: string, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

/**
 * `RequestMethod` is numeric in Nest 11, and a compiled TypeScript enum also carries the reverse
 * entries, so the lookup is built from the named half and read back rather than written out again —
 * a hard-coded `0..7` here would go quietly wrong on an upgrade.
 */
const METHOD_NAMES = new Map<unknown, string>();

for (const [name, value] of Object.entries(RequestMethod)) {
  if (!/^\d+$/.test(name)) METHOD_NAMES.set(value, name);
}

function controllersOf(module: object): ClassRef[] {
  return readMeta<ClassRef[]>(MODULE_METADATA.CONTROLLERS, module) ?? [];
}

function importsOf(module: object): unknown[] {
  return readMeta<unknown[]>(MODULE_METADATA.IMPORTS, module) ?? [];
}

/**
 * The walk Nest itself makes to find a route, done by hand because the export runs without a
 * container: no database to connect to, no port to bind, nothing to wait for.
 *
 * A hand-kept list of controllers is the obvious alternative and the obvious way for this reference
 * to go stale, and the module graph is the one place the framework already reads.
 */
function walk(module: object, seen: Set<object>, out: ClassRef[]): void {
  if (seen.has(module)) return;
  seen.add(module);

  out.push(...controllersOf(module));

  for (const imported of importsOf(module)) {
    // An entry is either the class or what a `forRoot()` returned — an object holding the class,
    // whose `module` may still be a promise. That last form carries no controllers today and is
    // passed over rather than awaited for nothing.
    if (typeof imported === 'function' || (imported && typeof imported === 'object')) {
      const candidate =
        typeof imported === 'function'
          ? imported
          : (imported as { module?: unknown }).module;

      if (typeof candidate === 'function') walk(candidate, seen, out);
    }
  }
}

function joinPath(controllerPath: string, handlerPath: string): string {
  const parts = [API_PREFIX, controllerPath, handlerPath]
    .flatMap((segment) => segment.split('/'))
    .filter((part) => part.length > 0);

  return `/${parts.join('/')}`;
}

/**
 * The same override the guard applies: a handler's own `@Roles` answers for the handler, and a
 * controller-wide one covers every route that does not name a role of its own.
 */
function accessOf(controller: ClassRef, handler: object): EndpointAccess {
  const roles = (
    readMeta<string[]>(REQUIRED_ROLES, handler) ??
    readMeta<string[]>(REQUIRED_ROLES, controller) ??
    []
  ).slice();

  // Optional-session first, because that is the order `JwtAuthGuard` checks, and a route that
  // carried both would otherwise be documented as ignoring a header it actually reads.
  if (readMeta<boolean>(OPTIONAL_SESSION, handler) === true) {
    return { kind: 'optional-session', roles };
  }

  const isPublic =
    readMeta<boolean>(IS_PUBLIC, handler) === true || readMeta<boolean>(IS_PUBLIC, controller) === true;

  return { kind: isPublic ? 'public' : 'session', roles };
}

function statusCodeOf(handler: object, method: string): number {
  // Nest's own default: a POST that creates answers 201, everything else 200.
  return readMeta<number>(HTTP_CODE_METADATA, handler) ?? (method === 'POST' ? 201 : 200);
}

export function collectEndpoints(): EndpointRecord[] {
  const controllers: ClassRef[] = [];

  walk(AppModule, new Set(), controllers);

  const records = controllers.flatMap((controller) => {
    const controllerPath = readMeta<string>(PATH_METADATA, controller) ?? '';

    return Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ name, handler: controller.prototype[name] }))
      .filter(({ handler }) => typeof handler === 'function')
      .filter(({ handler }) => Reflect.hasMetadata(METHOD_METADATA, handler as object))
      .map(({ name, handler }) => {
        const target = handler as object;
        const method = METHOD_NAMES.get(readMeta<unknown>(METHOD_METADATA, target));

        if (!method) {
          throw new Error(
            `${controller.name}.${name} carries a request method this export cannot name`,
          );
        }

        return {
          method,
          path: joinPath(controllerPath, readMeta<string>(PATH_METADATA, target) ?? ''),
          statusCode: statusCodeOf(target, method),
          access: accessOf(controller, target),
          controller: controller.name,
          handler: name,
        } satisfies EndpointRecord;
      });
  });

  return records.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

export function renderEndpoints(): string {
  return `${JSON.stringify(
    {
      // Read this file only as the output of a command, and regenerate it rather than editing it:
      // the drift test in `endpoint-reference.spec.ts` compares it against the application.
      generatedBy: 'bun run --filter @lms/api docs:export',
      endpoints: collectEndpoints(),
    },
    null,
    2,
  )}\n`;
}
