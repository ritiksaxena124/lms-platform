import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { IsUrl } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  ACTION_TARGET_TABLE_CODES,
  PERMISSION_CODES,
  ROLE_CODES,
  permissionsForRole,
  type PermissionCode,
} from '@lms/shared';

import {
  collectEndpoints,
  describeRequestFields,
  renderEndpoints,
  type EndpointRecord,
} from './endpoint-reference';

const COMMITTED = resolve(process.cwd(), '../site/content/endpoints.json');

function find(records: EndpointRecord[], method: string, path: string): EndpointRecord {
  const found = records.find((record) => record.method === method && record.path === path);

  if (!found) {
    throw new Error(`${method} ${path} is not in the export`);
  }
  return found;
}

function field(record: EndpointRecord, source: 'body' | 'query', name: string) {
  const found = record.request[source].find((candidate) => candidate.name === name);

  if (!found) {
    throw new Error(`${record.method} ${record.path} sends no ${source} field named ${name}`);
  }
  return found;
}

describe('the endpoint reference', () => {
  const endpoints = collectEndpoints();

  it('carries the public prefix on every path, and no doubled slash', () => {
    // The prefix is set once on the application, so a route list that omits it is a list of paths
    // nobody can actually call, and one that glues it on twice is the same mistake pointing the
    // other way.
    for (const record of endpoints) {
      expect(record.path.startsWith('/api/v1/'), record.path).toBe(true);
      expect(record.path).not.toMatch(/\/\//);
    }
  });

  it('lists every route Nest itself answers', () => {
    // The count is the guard against a module that was never walked. A controller Nest routes but the
    // export skips is a silent hole in a reference whose whole point is completeness.
    expect(endpoints.length).toBeGreaterThan(40);
    expect(new Set(endpoints.map((record) => `${record.method} ${record.path}`)).size).toBe(
      endpoints.length,
    );
  });

  it('names the three kinds of access the guard knows about', () => {
    // `@Public`, `@OptionalSession` and neither, in that order of checking — the same order
    // `JwtAuthGuard` uses, which is why an optional-session route is not also marked public.
    expect(new Set(endpoints.map((record) => record.access.kind))).toEqual(
      new Set(['public', 'optional-session', 'session']),
    );
  });

  it('marks the doors a stranger may knock on', () => {
    expect(find(endpoints, 'GET', '/api/v1/health').access).toEqual({
      kind: 'public',
      permissions: [],
      roles: [],
    });
    expect(find(endpoints, 'POST', '/api/v1/auth/login').access).toEqual({
      kind: 'public',
      permissions: [],
      roles: [],
    });
    // A catalog page that answers anyway but reads the session if one arrives: the outline that
    // knows who is asking, so the same URL serves a preview and a paid page.
    expect(find(endpoints, 'GET', '/api/v1/catalog/courses/:id').access).toEqual({
      kind: 'optional-session',
      permissions: [],
      roles: [],
    });
    expect(find(endpoints, 'GET', '/api/v1/auth/me').access).toEqual({
      kind: 'session',
      permissions: [],
      roles: [],
    });
  });

  it('inherits a controller-wide capability onto every route that does not name one', () => {
    // The accounts desk declares `@Permissions(ACCOUNT_MANAGE)` once on the class. A reader of the
    // reference has to see it on all four routes, because the route that forgets to say it is the
    // least guarded-looking line on the page.
    expect(find(endpoints, 'GET', '/api/v1/users').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.ACCOUNT_MANAGE],
      roles: [ROLE_CODES.OPS],
    });
    expect(find(endpoints, 'PATCH', '/api/v1/users/:id/role').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.ACCOUNT_MANAGE],
      roles: [ROLE_CODES.OPS],
    });
    // The activity log is a different capability on the same side of the desk: reading what happened
    // is not the same as deciding what an account is, and the reference prints the difference.
    expect(find(endpoints, 'GET', '/api/v1/actions').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.ACTIVITY_READ],
      roles: [ROLE_CODES.OPS],
    });
  });

  it('keeps one controller serving two sides split by route', () => {
    // `bookings` is the surface where a student and a teacher meet the same table from opposite
    // sides, so the capability belongs to the handler. A method-level `@Permissions` has to win over
    // nothing, and the one route that names none stays the exception the code says it is.
    expect(find(endpoints, 'GET', '/api/v1/bookings/slots').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.BOOKING_REQUEST],
      roles: [ROLE_CODES.STUDENT],
    });
    expect(find(endpoints, 'POST', '/api/v1/bookings/:id/confirm').access).toEqual({
      kind: 'session',
      permissions: [PERMISSION_CODES.BOOKING_ANSWER],
      roles: [ROLE_CODES.TEACHER],
    });
    expect(find(endpoints, 'POST', '/api/v1/bookings/:id/room').access).toEqual({
      kind: 'session',
      permissions: [],
      roles: [],
    });
  });

  it('prints the roles the matrix hands out, which no route writes down', () => {
    // A route states a capability; which accounts hold it is one table's answer. The two halves of
    // `access` have to agree, or the page tells a reader about a door the guard does not keep.
    for (const record of endpoints) {
      const { permissions, roles } = record.access;

      expect(roles, `${record.method} ${record.path}`).toEqual(
        permissions.length === 0
          ? []
          : (Object.values(ROLE_CODES) as string[]).filter((role) =>
              permissions.every((code) =>
                permissionsForRole(role).includes(code as PermissionCode),
              ),
            ),
      );
    }
  });

  it('reports the status each route answers with, defaulting the way Nest does', () => {
    // Most POSTs here say `@HttpCode(200)` because they return the resource they changed rather than
    // a pointer to one, so a reference that assumed 201 for every POST would be wrong about the
    // common case in this API.
    expect(find(endpoints, 'POST', '/api/v1/auth/register').statusCode).toBe(201);
    expect(find(endpoints, 'POST', '/api/v1/auth/login').statusCode).toBe(200);
    expect(find(endpoints, 'POST', '/api/v1/bookings').statusCode).toBe(200);
    expect(
      find(endpoints, 'POST', '/api/v1/modules/:moduleId/lessons/:lessonId/asset').statusCode,
    ).toBe(201);
    expect(find(endpoints, 'GET', '/api/v1/courses').statusCode).toBe(200);
    expect(find(endpoints, 'POST', '/api/v1/auth/logout').statusCode).toBe(204);
  });

  it('reflects the fields a caller sends, in the API’s own words', () => {
    const booking = find(endpoints, 'POST', '/api/v1/bookings');

    expect(booking.request.body.map((entry) => entry.name)).toEqual(['course', 'startsAt']);
    // The sentence belongs to the validator, not to the docs: this is what the route answers a
    // student who sends a clock face instead of an instant, so the page and the 400 cannot disagree.
    expect(field(booking, 'body', 'startsAt').rules).toEqual(['Pick a class from the calendar.']);
    // Bottom-up, which is the order TypeScript runs decorators in — the same order the metadata
    // holds them, so the export reports what the validator holds rather than pretending to sort it.
    expect(field(booking, 'body', 'course').rules).toEqual([
      'at most 200 characters',
      'not empty',
      'text',
    ]);
    expect(field(booking, 'body', 'course').optional).toBe(false);
    // Nothing in this address is a parameter, and nothing is a query string: the whole ask is a body.
    expect(booking.request.params).toEqual([]);
    expect(booking.request.query).toEqual([]);
  });

  it('splits the address apart from the question', () => {
    expect(find(endpoints, 'GET', '/api/v1/bookings/slots').request).toEqual({
      params: [],
      query: [
        {
          name: 'course',
          optional: false,
          conditional: false,
          nested: false,
          rules: ['at most 200 characters', 'not empty', 'text'],
          values: [],
        },
      ],
      body: [],
    });

    // A path segment is not a field of a DTO, so it is read off the route’s own shape — and the
    // upload route, whose bytes are the body, is all address and no fields.
    expect(find(endpoints, 'PATCH', '/api/v1/users/:id/role').request.params).toEqual(['id']);
    expect(
      find(endpoints, 'POST', '/api/v1/modules/:moduleId/lessons/:lessonId/asset').request,
    ).toEqual({ params: ['moduleId', 'lessonId'], query: [], body: [] });
  });

  it('names the closed set an enumerated field accepts', () => {
    const role = field(find(endpoints, 'PATCH', '/api/v1/users/:id/role'), 'body', 'role');

    // Which roles exist is `@lms/shared`’s answer, read here rather than retyped: a new role would
    // otherwise join the API and not the docs.
    expect(role.values).toEqual(Object.values(ROLE_CODES));
    expect(role.rules).toEqual([`one of: ${Object.values(ROLE_CODES).join(', ')}`]);
  });

  it('marks the field that only counts beside its partner', () => {
    const query = find(endpoints, 'GET', '/api/v1/actions').request.query;

    // `@IsOptional` and `@ValidateIf` are both conditional metadata and neither is a rule about the
    // value: the first says a field may be left out, the second says its rules only bite when
    // something else was sent. Only the second is worth a flag, because the prose has to explain it.
    const optional = query.find((entry) => entry.name === 'page');
    const paired = query.find((entry) => entry.name === 'targetTable');

    expect(optional).toMatchObject({ optional: true, conditional: false });
    expect(optional?.rules).toEqual(['at least 1', 'a whole number']);
    expect(paired).toMatchObject({ optional: false, conditional: true });
    expect(paired?.rules).toEqual([
      `one of: ${Object.values(ACTION_TARGET_TABLE_CODES).join(', ')}`,
      'targetTable must be given together with targetId.',
    ]);
  });

  it('says plainly that a route asks for nothing', () => {
    for (const [method, path] of [
      ['POST', '/api/v1/auth/logout'],
      ['GET', '/api/v1/health'],
    ] as const) {
      expect(find(endpoints, method, path).request).toEqual({
        params: [],
        query: [],
        body: [],
      });
    }
  });

  it('carries a nested object as one field, because its rules live in another class', () => {
    const price = field(find(endpoints, 'POST', '/api/v1/courses'), 'body', 'price');

    // `@ValidateNested` hands the checks to `CoursePriceDto`, and which class is not in the metadata
    // TypeScript keeps for a nullable property. So the export says what it can read and the
    // endpoint’s own explanation names the two halves — an object silently documented as a leaf would
    // be worse than one that admits it has children.
    expect(price).toMatchObject({ optional: true, nested: true, rules: [] });
  });

  it('refuses to invent a sentence for a rule it has never seen', () => {
    class UnmappedDto {
      @IsUrl()
      website!: string;
    }

    // A validator the table does not know would otherwise print nothing, and "this field has no
    // rules" is a lie about a field that has one the tool simply cannot read.
    expect(() => describeRequestFields(UnmappedDto)).toThrow(/isUrl/);
  });

  it('states what a route answers with, beside what it asks for', () => {
    // The two halves of a contract are read together or not at all: a page that lists a route's
    // fields but goes quiet about its body teaches a caller to send and never to read.
    const record = find(endpoints, 'POST', '/api/v1/auth/login');

    expect(record.response.kind).toBe('json');
    expect(record.response.declared).toBe('AuthSessionResponse');
    expect(record.response.fields.map((field) => field.name)).toEqual([
      'user',
      'accessToken',
      'tokenType',
      'expiresIn',
    ]);
  });

  it('keeps a route that answers with nothing in particular in one key', () => {
    // `{ booking: Booking }` is written in the handler rather than named, and the reader is told
    // the wrapper key they will actually find in the body.
    const record = find(endpoints, 'POST', '/api/v1/bookings');

    expect(record.response.fields.map((field) => field.name)).toEqual(['booking']);
    expect(record.response.fields[0]?.type).toBe('Booking');
  });

  it('says which routes send bytes and which send only a status', () => {
    const logout = find(endpoints, 'POST', '/api/v1/auth/logout');
    const video = find(endpoints, 'GET', '/api/v1/modules/:moduleId/lessons/:lessonId/asset/video');

    // A `204` has no body to document, and a recording has a body no list of keys could describe.
    // Both are answers a caller has to be told about, and neither is the same as a route this
    // export failed to read.
    expect(logout.response.kind).toBe('none');
    expect(video.response.kind).toBe('stream');
  });

  it('sorts by resource so the rendered table reads in one order', () => {
    const paths = endpoints.map((record) => record.path);

    expect([...paths].sort()).toEqual(paths);
  });

  it('matches the file the public docs render', () => {
    // The generated table is read from `apps/site/content/endpoints.json`, so a route added, renamed
    // or re-guarded would otherwise keep the docs saying something the API no longer does — and the
    // build would be content with it. Re-run `bun run docs:export` and commit the result.
    const committed = readFileSync(COMMITTED, 'utf8').replace(/\r\n/g, '\n');

    expect(committed).toBe(renderEndpoints());
  });
});
