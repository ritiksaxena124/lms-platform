import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectEndpoints, renderEndpoints, type EndpointRecord } from './endpoint-reference';

const COMMITTED = resolve(process.cwd(), '../site/content/endpoints.json');

function find(records: EndpointRecord[], method: string, path: string): EndpointRecord {
  const found = records.find((record) => record.method === method && record.path === path);

  if (!found) {
    throw new Error(`${method} ${path} is not in the export`);
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
    expect(find(endpoints, 'GET', '/api/v1/health').access).toEqual({ kind: 'public', roles: [] });
    expect(find(endpoints, 'POST', '/api/v1/auth/login').access).toEqual({
      kind: 'public',
      roles: [],
    });
    // A catalog page that answers anyway but reads the session if one arrives: the outline that
    // knows who is asking, so the same URL serves a preview and a paid page.
    expect(find(endpoints, 'GET', '/api/v1/catalog/courses/:id').access).toEqual({
      kind: 'optional-session',
      roles: [],
    });
    expect(find(endpoints, 'GET', '/api/v1/auth/me').access).toEqual({
      kind: 'session',
      roles: [],
    });
  });

  it('inherits a controller-wide role onto every route that does not name one', () => {
    // The accounts desk declares `@Roles(OPS)` once on the class. A reader of the reference has to
    // see it on all four routes, because the route that forgets to say it is the least guarded-
    // looking line on the page.
    expect(find(endpoints, 'GET', '/api/v1/users').access).toEqual({ kind: 'session', roles: ['ops'] });
    expect(find(endpoints, 'PATCH', '/api/v1/users/:id/role').access).toEqual({
      kind: 'session',
      roles: ['ops'],
    });
    expect(find(endpoints, 'GET', '/api/v1/actions').access).toEqual({
      kind: 'session',
      roles: ['ops'],
    });
  });

  it('keeps one controller serving two roles split by route', () => {
    // `bookings` is the surface where a student and a teacher meet the same table from opposite
    // sides, so the role belongs to the handler. A method-level `@Roles` has to win over nothing,
    // and the one route that names no role stays the exception the code says it is.
    expect(find(endpoints, 'GET', '/api/v1/bookings/slots').access).toEqual({
      kind: 'session',
      roles: ['student'],
    });
    expect(find(endpoints, 'POST', '/api/v1/bookings/:id/confirm').access).toEqual({
      kind: 'session',
      roles: ['teacher'],
    });
    expect(find(endpoints, 'POST', '/api/v1/bookings/:id/room').access).toEqual({
      kind: 'session',
      roles: [],
    });
  });

  it('reports the status each route answers with, defaulting the way Nest does', () => {
    // Most POSTs here say `@HttpCode(200)` because they return the resource they changed rather than
    // a pointer to one, so a reference that assumed 201 for every POST would be wrong about the
    // common case in this API.
    expect(find(endpoints, 'POST', '/api/v1/auth/register').statusCode).toBe(201);
    expect(find(endpoints, 'POST', '/api/v1/auth/login').statusCode).toBe(200);
    expect(find(endpoints, 'POST', '/api/v1/bookings').statusCode).toBe(200);
    expect(find(endpoints, 'POST', '/api/v1/modules/:moduleId/lessons/:lessonId/asset').statusCode).toBe(
      201,
    );
    expect(find(endpoints, 'GET', '/api/v1/courses').statusCode).toBe(200);
    expect(find(endpoints, 'POST', '/api/v1/auth/logout').statusCode).toBe(204);
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
