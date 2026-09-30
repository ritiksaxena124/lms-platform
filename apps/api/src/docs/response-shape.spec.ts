import { describe, expect, it } from 'vitest';

import { buildTypeIndex, resolveResponse, shapeOf, type TypeIndex } from './response-shape';

/**
 * A hand-built index, so a test can state a shape in one line rather than in a fixture folder.
 *
 * The shapes the resolver answers with on a real run are checked against the repository further
 * down — `resolveResponse` reads the controller that is actually deployed.
 */
function indexFrom(source: string): TypeIndex {
  return JSON.parse(source) as TypeIndex;
}

describe('the shape a response type declares', () => {
  it('takes the top-level keys, in the order the type writes them', () => {
    const shape = shapeOf(
      indexFrom(
        JSON.stringify({
          SessionResponse: {
            kind: 'interface',
            note: 'What a door in hands back.',
            fields: [
              { name: 'user', type: 'AuthUser', optional: false, note: 'The account.' },
              { name: 'accessToken', type: 'string', optional: false, note: '' },
              { name: 'expiresIn', type: 'number', optional: true, note: '' },
            ],
          },
        }),
      ),
      'SessionResponse',
    );

    expect(shape).toEqual({
      declared: 'SessionResponse',
      note: 'What a door in hands back.',
      fields: [
        { name: 'user', type: 'AuthUser', optional: false, note: 'The account.' },
        { name: 'accessToken', type: 'string', optional: false, note: '' },
        { name: 'expiresIn', type: 'number', optional: true, note: '' },
      ],
    });
  });

  it('keeps an inline object as the keys it holds', () => {
    const shape = shapeOf(indexFrom('{}'), '{ booking: Booking; heldUntil: string | null }');

    expect(shape.declared).toBe('{ booking: Booking; heldUntil: string | null }');
    expect(shape.fields.map((field) => field.name)).toEqual(['booking', 'heldUntil']);
    expect(shape.fields[1]).toMatchObject({ type: 'string | null' });
  });

  it('reads a list as the item it holds, because the page says "list of" itself', () => {
    const shape = shapeOf(
      indexFrom(
        JSON.stringify({
          Slot: {
            kind: 'interface',
            note: '',
            fields: [{ name: 'startsAt', type: 'string', optional: false, note: '' }],
          },
        }),
      ),
      'Slot[]',
    );

    expect(shape.declared).toBe('Slot');
    expect(shape.fields.map((field) => field.name)).toEqual(['startsAt']);
  });

  it('follows an alias that points at another type', () => {
    const index = indexFrom(
      JSON.stringify({
        Roster: {
          kind: 'interface',
          note: 'Who took a place.',
          fields: [{ name: 'studentId', type: 'string', optional: false, note: '' }],
        },
        RosterResponse: { kind: 'alias', note: '', target: 'Roster' },
      }),
    );

    expect(shapeOf(index, 'RosterResponse[]').declared).toBe('Roster');
    expect(shapeOf(index, 'RosterResponse').note).toBe('Who took a place.');
  });

  it('refuses a type this read cannot name', () => {
    // An empty block on the page reads as "this route answers nothing", which is a different fact
    // from one the exporter failed to find.
    expect(() => shapeOf(indexFrom('{}'), 'NotInAnyFile')).toThrow(/NotInAnyFile/);
  });

  it('leaves a plain value a plain answer, with no fields to show', () => {
    const shape = shapeOf(indexFrom('{}'), 'string');

    expect(shape.declared).toBe('string');
    expect(shape.fields).toEqual([]);
  });
});

describe('the response a deployed handler declares', () => {
  it('names the keys a session route hands back', () => {
    const shape = resolveResponse('AuthController', 'login');

    expect(shape).toMatchObject({ kind: 'json', declared: 'AuthSessionResponse' });
    expect(shape.fields.map((field) => field.name)).toEqual([
      'user',
      'accessToken',
      'tokenType',
      'expiresIn',
    ]);
  });

  it('reads an inline return type off the handler itself', () => {
    const shape = resolveResponse('BookingsController', 'create');

    expect(shape.kind).toBe('json');
    expect(shape.fields.map((field) => field.name)).toEqual(['booking']);
    expect(shape.fields[0]?.type).toBe('Booking');
  });

  it('says so when a route answers with a status and nothing else', () => {
    expect(resolveResponse('AuthController', 'logout')).toMatchObject({
      kind: 'none',
      fields: [],
    });
  });

  it('says so when the route writes the bytes itself', () => {
    // The video routes take the response object over, so the shared reader — not a serialiser —
    // decides the status, the headers and the end of the stream.
    expect(resolveResponse('LessonAssetsController', 'play').kind).toBe('stream');
    expect(resolveResponse('CatalogController', 'video').kind).toBe('stream');
  });

  it('reads a type that holds no named fields as the free map it is', () => {
    // `LogFields` is `[key: string]: unknown`, so the honest answer is an empty list rather than a
    // page that claims the scan found something.
    expect(shapeOf(buildTypeIndex(), 'LogFields').fields).toEqual([]);
  });

  it('refuses a handler that does not say what it answers with', () => {
    expect(() => resolveResponse('NoSuchController', 'nope')).toThrow(/NoSuchController/);
  });
});
