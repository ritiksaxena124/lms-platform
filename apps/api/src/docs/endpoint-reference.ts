import 'reflect-metadata';

import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { getMetadataStorage } from 'class-validator';

import { API_PREFIX } from '../common/http/api-prefix';
import { AppModule } from '../app.module';
import { IS_PUBLIC } from '../modules/auth/public.decorator';
import { OPTIONAL_SESSION } from '../modules/auth/optional-session.decorator';
import { REQUIRED_PERMISSIONS } from '../modules/auth/permissions.decorator';
import { heldByRoles, isPermissionCode, type PermissionCode } from '@lms/shared';
import { resolveResponse, type ResponseRecord } from './response-shape';

/** What a caller has to bring, as `JwtAuthGuard` and `PermissionsGuard` actually decide it. */
export interface EndpointAccess {
  /**
   * `public` ignores the session header; `optional-session` reads one if it arrives and asks for
   * nothing if it does not; `session` refuses the call without it. The order is the guard's own —
   * it tests the optional flag first, which is why an optional route never also says it is public.
   */
  kind: 'public' | 'optional-session' | 'session';
  /** What the route states: the capabilities an account has to hold to get past the guard. */
  permissions: string[];
  /**
   * Which roles the matrix hands those capabilities to, read out of `ROLE_PERMISSIONS` rather than
   * written down again next to the route. A role is an answer to the question the permissions ask,
   * and the site prints it because a reader scans for the word they already know.
   *
   * Empty means the route names no capability, so any signed-in account passes — or any caller at
   * all when `kind` is `public`.
   */
  roles: string[];
}

export interface EndpointRecord {
  method: string;
  /** Includes the public prefix, because that is the string a reader has to send. */
  path: string;
  /** What a successful call answers with — `@HttpCode`, or the default Nest picks. */
  statusCode: number;
  access: EndpointAccess;
  /** What the caller has to send, read off the same decorators the request is checked by. */
  request: EndpointRequest;
  /** What the route answers with, read off the type the handler declares. */
  response: ResponseRecord;
  /** Where the route lives, so a reader who wants the rules behind it can find the file. */
  controller: string;
  handler: string;
}

/** One field of a body or a query string, as the validator that guards it describes itself. */
export interface RequestField {
  /** The property name, which is the key a caller writes. */
  name: string;
  /** `@IsOptional`: the field may be left out entirely. */
  optional: boolean;
  /** `@ValidateIf`: the rules below bite only when the caller sent something else. A pair half of
   * which is missing is a mistake the route reports against this field, so the page has to say so. */
  conditional: boolean;
  /** `@ValidateNested`: the checks live in another class, which the metadata cannot name back. */
  nested: boolean;
  /** What the route answers when this field is wrong — the validator’s own sentence when it has
   * one, because a page that paraphrased a 400 would be free to be wrong about it. */
  rules: string[];
  /** The closed set an enumerated field accepts, empty when the field is not enumerated. */
  values: string[];
}

export interface EndpointRequest {
  /** Names taken from the path, in the order the address offers them. */
  params: string[];
  query: RequestField[];
  body: RequestField[];
}

/** One `class-validator` rule as it is stored, narrowed to what this export reads. */
interface ValidationMeta {
  type: string;
  name?: string;
  propertyName: string;
  constraints: unknown[];
  message?: string | ((args: never) => string);
  each: boolean;
}

/** A class as a value, which is what `reflect-metadata` and `class-validator` both key on. */
type ClassLike = new (...args: never[]) => unknown;

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
        typeof imported === 'function' ? imported : (imported as { module?: unknown }).module;

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
 * The same override the guard applies: a handler's own `@Permissions` answers for the handler, and a
 * controller-wide one covers every route that does not name a capability of its own.
 */
function accessOf(controller: ClassRef, handler: object): EndpointAccess {
  const permissions = declarable(
    readMeta<string[]>(REQUIRED_PERMISSIONS, handler) ??
      readMeta<string[]>(REQUIRED_PERMISSIONS, controller) ??
      [],
    controller.name,
  );

  // Optional-session first, because that is the order `JwtAuthGuard` checks, and a route that
  // carried both would otherwise be documented as ignoring a header it actually reads.
  if (readMeta<boolean>(OPTIONAL_SESSION, handler) === true) {
    return { kind: 'optional-session', permissions, roles: rolesHolding(permissions) };
  }

  const isPublic =
    readMeta<boolean>(IS_PUBLIC, handler) === true ||
    readMeta<boolean>(IS_PUBLIC, controller) === true;

  return { kind: isPublic ? 'public' : 'session', permissions, roles: rolesHolding(permissions) };
}

/**
 * A route can only ask for a capability the matrix hands out.
 *
 * The guard would answer an unknown code by refusing everybody — fail closed, which is the right
 * thing at runtime — but a reference that printed it would be documenting a door nobody can open,
 * so the export refuses to build instead.
 */
function declarable(codes: string[], controllerName: string): PermissionCode[] {
  return codes.map((code) => {
    if (!isPermissionCode(code)) {
      throw new Error(
        `${controllerName} asks for ${code}, which is not a capability in ROLE_PERMISSIONS`,
      );
    }
    return code;
  });
}

/** Every role the matrix gives all of these capabilities to, in the order the roles are declared. */
function rolesHolding(permissions: PermissionCode[]): string[] {
  const held = permissions.map((code) => heldByRoles(code));
  if (held.length === 0) return [];

  return held[0]?.filter((role) => held.every((codes) => codes.includes(role))) ?? [];
}

function statusCodeOf(handler: object, method: string): number {
  // Nest's own default: a POST that creates answers 201, everything else 200.
  return readMeta<number>(HTTP_CODE_METADATA, handler) ?? (method === 'POST' ? 201 : 200);
}

/**
 * The sentence a rule tells when the validator itself wrote none.
 *
 * Most validators in this API carry their own message — the sentence a form turns red with — and the
 * export prefers that text, because it is what the route actually answers. This table is the fallback
 * for the ones that do not, keyed by the `class-validator` name. A name missing from it is an error
 * rather than an empty list: a field documented as having no rules is a field a caller will get wrong.
 */
const RULE_SENTENCES: Record<string, (args: unknown[]) => string> = {
  isString: () => 'text',
  isNotEmpty: () => 'not empty',
  isEmail: () => 'an email address',
  isUuid: (args) => (args[0] ? `a version-${String(args[0])} uuid` : 'a uuid'),
  isBoolean: () => 'true or false',
  isInt: () => 'a whole number',
  isNumber: () => 'a number',
  min: (args) => `at least ${String(args[0])}`,
  max: (args) => `at most ${String(args[0])}`,
  maxLength: (args) => `at most ${String(args[0])} characters`,
  minLength: (args) => `at least ${String(args[0])} characters`,
  isLength: (args) => `between ${String(args[0])} and ${String(args[1])} characters`,
  isIso8601: () => 'an ISO-8601 instant',
  isDateString: () => 'a date',
  isIn: (args) => `one of: ${(args[0] as unknown[]).map(String).join(', ')}`,
  matches: (args) => `shaped like ${String(args[0])}`,
  isArray: () => 'a list',
  arrayMinSize: (args) => `no fewer than ${String(args[0])} entries`,
  arrayMaxSize: (args) => `no more than ${String(args[0])} entries`,
  arrayUnique: () => 'no repeats',
  isDefined: () => 'required',
  isIanaTimeZone: () => 'an IANA zone like Asia/Kolkata',
};

/** The three ways a handler’s parameter list says "this part of the request", by enum name. */
const REQUEST_SOURCES: Record<string, 'body' | 'query' | 'param'> = {
  BODY: 'body',
  QUERY: 'query',
  PARAM: 'param',
};

/**
 * `RouteParamtypes` is numeric, so the same read that names HTTP methods names these: built from the
 * named half and looked up in reverse, rather than writing `3 = body` where an upgrade renumbers it.
 */
const PARAM_TYPE_NAMES = new Map<unknown, string>();

for (const [name, value] of Object.entries(RouteParamtypes)) {
  if (!/^\d+$/.test(name)) PARAM_TYPE_NAMES.set(value, name);
}

/** Every rule a DTO class holds, grouped by the property it guards, in the order the class declares. */
export function describeRequestFields(dto: ClassLike): RequestField[] {
  const stored = getMetadataStorage() as unknown as {
    getTargetValidationMetadatas: (
      target: ClassLike,
      schema: string,
      always: boolean,
      strictGroups: boolean,
    ) => ValidationMeta[];
  };
  const fields = new Map<string, RequestField>();

  for (const meta of stored.getTargetValidationMetadatas(dto, dto.name, true, false)) {
    const field = fields.get(meta.propertyName) ?? {
      name: meta.propertyName,
      optional: false,
      conditional: false,
      nested: false,
      rules: [],
      values: [],
    };
    fields.set(meta.propertyName, field);

    // Three decorators describe when the others apply rather than what a value has to look like, and
    // each one belongs to a flag on the field instead of a line in `rules`.
    if (meta.type === 'conditionalValidation' && meta.name === 'isOptional') {
      field.optional = true;
      continue;
    }
    if (meta.type === 'conditionalValidation') {
      field.conditional = true;
      continue;
    }
    if (meta.type === 'nestedValidation') {
      field.nested = true;
      continue;
    }

    const named = meta.name ?? meta.type;
    const message =
      typeof meta.message === 'string' && meta.message.length > 0 ? meta.message : null;
    const fallback = RULE_SENTENCES[named];

    if (!message && !fallback) {
      throw new Error(
        `${dto.name}.${meta.propertyName} is guarded by ${named}, which this export has no sentence for`,
      );
    }

    field.rules.push(
      `${meta.each ? 'each entry: ' : ''}${message ?? fallback?.(meta.constraints) ?? named}`,
    );

    // An enumerated field states its set, so the page can print the words a caller may send instead
    // of only the shape of one that is wrong.
    if (named === 'isIn') field.values = (meta.constraints[0] as unknown[]).map(String);
  }

  return [...fields.values()];
}

/** What one handler reads off the request, in the three places a caller can put it. */
function requestOf(controller: ClassRef, handlerName: string, path: string): EndpointRequest {
  const routeArgs =
    (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) as
      Record<string, { index: number; data?: unknown }> | undefined) ?? {};
  const paramTypes =
    (Reflect.getMetadata('design:paramtypes', controller.prototype, handlerName) as
      (ClassLike | undefined)[] | undefined) ?? [];

  const body: RequestField[] = [];
  const query: RequestField[] = [];

  for (const [key, arg] of Object.entries(routeArgs).sort((a, b) => a[0].localeCompare(b[0]))) {
    // A custom param decorator — the one that hands the handler the signed-in account — keys itself
    // with a generated prefix rather than a number, and it reads nothing a caller can send.
    const [typeRaw = ''] = key.split(':');
    if (!/^\d+$/.test(typeRaw)) continue;

    const source = REQUEST_SOURCES[PARAM_TYPE_NAMES.get(Number(typeRaw)) ?? ''];
    if (source === 'param') {
      const offered = String(arg.data ?? '');
      if (offered && !path.includes(`:${offered}`)) {
        throw new Error(
          `${controller.name}.${handlerName} reads :${offered}, which its address does not offer`,
        );
      }
      continue;
    }
    if (!source) continue;

    const dto = paramTypes[arg.index];
    if (typeof dto !== 'function') {
      throw new Error(
        `${controller.name}.${handlerName} takes its ${source} as something other than a DTO class`,
      );
    }

    (source === 'body' ? body : query).push(...describeRequestFields(dto));
  }

  return {
    params: path
      .split('/')
      .filter((part) => part.startsWith(':'))
      .map((part) => part.slice(1)),
    query,
    body,
  };
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

        const path = joinPath(controllerPath, readMeta<string>(PATH_METADATA, target) ?? '');

        return {
          method,
          path,
          statusCode: statusCodeOf(target, method),
          access: accessOf(controller, target),
          request: requestOf(controller, name, path),
          response: resolveResponse(controller.name, name),
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
