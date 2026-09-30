import { describe, expect, it } from 'vitest';

import {
  buildTypeIndex,
  parseTypeFields,
  resolveResponse,
  shapeOf,
  type TypeIndex,
} from './response-shape';

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

  it('keeps the sentence written above a field, even when that sentence has a semicolon', () => {
    // The note is the reason the key exists, and it is the part a caller cannot work out from the
    // name. A comment is also the one thing in a type body whose own punctuation has to be ignored —
    // split on the semicolon inside it and the field it labels is lost along with the note.
    const fields = parseTypeFields(
      [
        'user: AuthUser;',
        '/** Seconds until the access token dies; a portal refreshes inside this window. */',
        'expiresIn: number;',
      ].join('\n'),
    );

    expect(fields.map((field) => field.name)).toEqual(['user', 'expiresIn']);
    expect(fields[0]?.note).toBe('');
    expect(fields[1]?.note).toBe(
      'Seconds until the access token dies; a portal refreshes inside this window.',
    );
  });

  it('carries the keys an interface inherits, because a page that dropped them would lie', () => {
    // `OpsAccountDetail extends OpsAccount` adds one key of its own and keeps nine from the row it
    // extends. Reading only the body would document the detail as a single `counts` field, which is
    // the quiet kind of wrong: the table renders, and nothing about it says it is short.
    const shape = shapeOf(
      indexFrom(
        JSON.stringify({
          Account: {
            kind: 'interface',
            note: '',
            parents: [],
            fields: [{ name: 'id', type: 'string', optional: false, note: 'The account.' }],
          },
          AccountDetail: {
            kind: 'interface',
            note: '',
            parents: ['Account'],
            fields: [{ name: 'counts', type: 'Counts', optional: false, note: '' }],
          },
        }),
      ),
      'AccountDetail',
    );

    expect(shape.fields.map((field) => field.name)).toEqual(['id', 'counts']);
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
  it('names the keys a session route hands back', () => {    const shape = resolveResponse('AuthController', 'login');

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

  it('reaches through a named type to the keys it holds', () => {
    // `user: AuthUser` documents nothing for a reader who has to render the thing, and the keys live
    // one name away in the same contract folder. The page shows them under the answer that uses them.
    const shape = resolveResponse('AuthController', 'login');
    const user = shape.types.find((type) => type.name === 'AuthUser');

    expect(user?.fields.map((field) => field.name)).toContain('emailVerifiedAt');
  });

  it('follows a type two names deep, and says each name once', () => {
    const shape = resolveResponse('CatalogController', 'read');
    const names = shape.types.map((type) => type.name);

    expect(names).toContain('CatalogModule');
    expect(names).toContain('CatalogLesson');
    expect(new Set(names).size).toBe(names.length);
  });

  it('reaches through an object the handler spelled out inline', () => {
    // `Promise<{ course: Course }>` names no type of its own, but the row it wraps still has keys a
    // caller is going to read, so the inline body is walked like a declared one.
    expect(resolveResponse('CoursesController', 'read').types.map((type) => type.name)).toContain(
      'Course',
    );
  });

  it('refuses a handler that does not say what it answers with', () => {
    expect(() => resolveResponse('NoSuchController', 'nope')).toThrow(/NoSuchController/);
  });
});
