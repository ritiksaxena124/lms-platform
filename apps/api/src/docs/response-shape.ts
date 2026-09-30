import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What a route answers with, read off the type the handler declares rather than written out again.
 *
 * The API and its portals share one contract folder — `packages/shared` — and every handler states
 * its own return type. Both halves are therefore already in code, so this read exists to keep the
 * docs from holding a third copy: a renamed field breaks a compile before it breaks a page, and a
 * page that restated the keys by hand would be free to be wrong about them.
 *
 * Like the schema read beside it, this is a text scan rather than a TypeScript program. The types
 * here are property lists, and a program that type-checked the application would need its tsconfig,
 * its generated Prisma client and thirty seconds of patience to answer one question a brace counter
 * answers in place. What this cannot name it throws about rather than leaving blank: a docs block
 * with no fields reads as "this route answers nothing", which is a different claim from one the
 * exporter failed to make.
 */

/** One property of a response, as the type that declares it spells it. */
export interface ResponseField {
  name: string;
  /** The type as written, with its inner spacing folded onto one line. */
  type: string;
  optional: boolean;
  /** The sentence written above the field, which is usually the reason the field exists. */
  note: string;
}

/** The keys a return type holds. */
export interface ResponseShape {
  /** The name the handler wrote, or the type spelled out inline when there was no name. */
  declared: string;
  note: string;
  fields: ResponseField[];
}

/** A named object the answer reaches through, held once however many fields point at it. */
export interface ResponseTypeDoc {
  name: string;
  note: string;
  fields: ResponseField[];
}

export interface ResponseRecord extends ResponseShape {
  /**
   * `json` a body of the keys listed, `none` a status and nothing else, `stream` the bytes the
   * handler writes to the response itself — which is why no list of keys could describe it.
   */
  kind: 'json' | 'none' | 'stream';
  /**
   * The objects the listed keys lead to, by name.
   *
   * A field typed `user: AuthUser` says nothing to the reader who has to draw the row, and the keys
   * live one name away in the same contract folder, so they are carried with the answer rather than
   * left for a page to look up.
   */
  types: ResponseTypeDoc[];
}

/** One declared type, as the index found it. */
type TypeEntry =
  | { kind: 'interface'; note: string; parents: string[]; fields: ResponseField[] }
  | { kind: 'alias'; note: string; target: string };

/** Declaration name to entry, across every folder this read is allowed to look in. */
export type TypeIndex = Record<string, TypeEntry>;

const SHARED_DIR = resolve(process.cwd(), '../../packages/shared/src');
const API_SRC_DIR = resolve(process.cwd(), 'src');

function typeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) return typeFiles(path);

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/** The text of a `/** … *\/` block, folded onto one line the page can put beside a field. */
function commentText(block: string): string {
  return block
    .replace(/^\/\*+|\*\/$/gu, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/u, '').trim())
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * The doc block a declaration or a field carries, or an empty string.
 *
 * `before` is the text that runs up to the thing being named, so a comment counts only when nothing
 * but whitespace separates it from that name — a note with a statement between it and this field
 * belongs to the statement, not here.
 */
function trailingDocComment(before: string): string {
  const last = [...before.matchAll(/\/\*\*[\s\S]*?\*\//gu)].pop();
  if (!last) return '';
  if (before.slice((last.index ?? 0) + last[0].length).trim().length > 0) return '';

  return commentText(last[0]);
}

/** A bracket that cannot appear in a type body, used to stand in for a comment while it is parsed. */
const MARK = '\u0000';

/** Every property at the top level of a type body, each with the comment above it. */
export function parseTypeFields(body: string): ResponseField[] {
  // A comment is taken out of the text first and put back as a marker, because a note is prose and
  // prose contains the semicolons and line breaks the field list is split on. Left in place, the
  // sentence above `expiresIn` would split in the middle of itself and take the field with it.
  const blocks: string[] = [];
  const stripped = body.replace(/\/\*[\s\S]*?\*\//gu, (block) => {
    blocks.push(block);
    return `${MARK}${blocks.length - 1}${MARK}`;
  });

  const marker = new RegExp(`${MARK}(\\d+)${MARK}`, 'gu');
  const fields: ResponseField[] = [];
  const notes: number[] = [];
  let entry = '';
  let depth = 0;

  const close = (): void => {
    const text = entry;
    entry = '';

    const taken = [...text.matchAll(marker)].map((match) => Number(match[1]));
    const code = text.replace(marker, '').trim();
    const match = code.match(/^(\w+)(\?)?:\s*(.+)$/su);

    // Text with no field in it is a comment standing on its own between two fields. It stays held
    // until the field it sits above arrives, which is the difference between a note and a note about
    // nothing.
    if (!match) {
      notes.push(...taken);
      return;
    }

    const labelled = notes.length > 0 ? notes[notes.length - 1] : taken.at(-1);
    const block = labelled === undefined ? undefined : blocks[labelled];

    fields.push({
      name: match[1] ?? '',
      optional: match[2] === '?',
      type: (match[3] ?? '').replace(/\s+/gu, ' ').trim(),
      note: block === undefined ? '' : commentText(block),
    });

    notes.length = 0;
  };

  for (const character of stripped) {
    if ('([{<'.includes(character)) depth += 1;
    if (')]}>'.includes(character)) depth -= 1;

    // A separator at the top level ends one field. Inside a nested object or a generic the same
    // character is part of the type's own text, which is why the depth is kept.
    if (depth <= 0 && (character === ';' || character === '\n')) {
      close();
      continue;
    }

    entry += character;
  }

  if (entry.trim().length > 0) close();

  return fields;
}

/** The lines of a type body with every comment and blank between them removed. */
function bodyLines(body: string): string[] {
  return body
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, '').trim())
    .filter((line) => line.length > 0 && line !== ';');
}

/** A body whose members are operations — `sign(…)` — rather than the fields of a shape. */
function hasCallSignature(body: string): boolean {
  return bodyLines(body).some((line) => /^[\w$]+\s*[?(]/u.test(line));
}

/** A type body whose only members are index signatures, which name no field on purpose. */
function indexedOnly(body: string): boolean {
  const lines = bodyLines(body);

  return lines.length > 0 && lines.every((line) => /^\[[^\]]+\]\??:\s*/u.test(line));
}

/** The declarations one source file holds, by name, in the order they appear. */
function declarationsOf(source: string): Record<string, TypeEntry> {
  const found: Record<string, TypeEntry> = {};
  const pattern = /(?:^|\n)(?:export\s+)?(interface|type)\s+(\w+)([^{=]*)/gu;

  for (const match of source.matchAll(pattern)) {
    const name = match[2];
    if (!name || found[name]) continue;

    const note = trailingDocComment(source.slice(0, match.index ?? 0));
    const start = (match.index ?? 0) + match[0].length;
    const brace = source.indexOf('{', start);
    const lineEnd = source.indexOf('\n', start);

    // `interface X { … }` and `type X = { … }` both open a body; anything else is an alias whose
    // text runs to the end of the line it was written on.
    if (brace !== -1 && (lineEnd === -1 || brace < lineEnd)) {
      let depth = 0;
      let end = brace;

      for (; end < source.length; end += 1) {
        if (source[end] === '{') depth += 1;
        if (source[end] === '}') depth -= 1;
        if (depth === 0) break;
      }

      const fields = parseTypeFields(source.slice(brace + 1, end));
      const body = source.slice(brace + 1, end);

      // A port is a list of operations, not a shape a route hands back, and the two are told apart
      // by whether anything in the body can be called. Skipping it keeps the index to the types a
      // reader could actually be shown; a handler that returned one would fail on the name instead.
      if (hasCallSignature(body)) continue;

      // A body with text and no field parsed is a shape this scanner mis-read rather than a type
      // with nothing in it, and the difference is only visible on the page that went quiet. The one
      // honest empty answer is an index signature — `[key: string]: unknown` — which holds whatever
      // a caller puts in it and therefore names nothing.
      if (fields.length === 0 && body.trim().length > 0 && !indexedOnly(body)) {
        throw new Error(
          `Could not read the fields of "${name}", which declares a body this scan cannot parse`,
        );
      }

      // `interface X extends Y, Z { … }` — the heritage clause lives between the name and the brace.
      const heritage = match[3]?.trim();
      const parents = heritage
        ? [...heritage.matchAll(/(?:^|,)\s*([\w$]+)/gu)].map((m) => m[1] ?? '')
        : [];

      found[name] = { kind: 'interface', note, parents, fields };
      continue;
    }

    const equals = source.indexOf('=', start);
    if (equals === -1 || (lineEnd !== -1 && equals > lineEnd)) continue;

    const target = source
      .slice(equals + 1, lineEnd === -1 ? undefined : lineEnd)
      .replace(/;+$/u, '')
      .replace(/\s+/gu, ' ')
      .trim();

    found[name] = { kind: 'alias', note, target };
  }

  return found;
}

let indexCache: TypeIndex | undefined;

/**
 * Every type the shared contract folder and the API's own modules declare.
 *
 * `packages/shared` is read first: it is what the portals import, so a name held there is the one a
 * caller is being handed. A local declaration counts only when the shared folder has not used the
 * name already.
 */
export function buildTypeIndex(): TypeIndex {
  if (indexCache) return indexCache;

  const index: TypeIndex = {};

  for (const dir of [SHARED_DIR, API_SRC_DIR]) {
    for (const path of typeFiles(dir)) {
      for (const [name, entry] of Object.entries(declarationsOf(readSource(path)))) {
        index[name] ??= entry;
      }
    }
  }

  indexCache = index;

  return index;
}

/** The name a type text settles on, following aliases and stripping a list's brackets. */
function namedType(index: TypeIndex, text: string): { name: string; entry?: TypeEntry } {
  let name = text.trim().replace(/;+$/u, '');

  // `Foo[]`, `Array<Foo>` and `Foo | null` all describe the same shape to a reader, and the page
  // says "a list of" or "or nothing" from the type text it is given.
  for (;;) {
    const list = name.match(/^(.+)\[\]$/u) ?? name.match(/^Array<(.+)>$/u);
    if (list?.[1]) {
      name = list[1].trim();
      continue;
    }

    const alias = index[name];

    if (alias?.kind === 'alias' && alias.target) {
      name = alias.target;
      continue;
    }

    return { name, entry: alias };
  }
}

/** The keys a return type holds, resolved through whatever names it uses. */
export function shapeOf(index: TypeIndex, typeText: string): ResponseShape {
  const text = typeText.trim().replace(/;+$/u, '');

  if (text.startsWith('{')) {
    const fields = parseTypeFields(text.slice(1, text.lastIndexOf('}')));

    return { declared: text.replace(/\s+/gu, ' '), note: '', fields };
  }

  const bare = text.replace(/\[\]$|^\s*Array<|>\s*$/gu, '').trim();

  if (/^(string|number|boolean|bigint|null|undefined|unknown|never|void)$/u.test(bare)) {
    return { declared: text, note: '', fields: [] };
  }

  const { name, entry } = namedType(index, text);

  if (!entry) {
    throw new Error(`No declaration for the response type "${name}" was found to read`);
  }

  if (entry.kind === 'interface') {
    return { declared: name, note: entry.note, fields: flattenFields(index, name, new Set()) };
  }

  return shapeOf(index, entry.target);
}

/** Every field an interface declares, including those it inherits from its parents. */
function flattenFields(index: TypeIndex, name: string, seen: Set<string>): ResponseField[] {
  if (seen.has(name)) return [];
  seen.add(name);

  const entry = index[name];
  if (!entry || entry.kind !== 'interface') return [];

  const own = entry.fields;
  const inherited = (entry.parents ?? []).flatMap((parent) => flattenFields(index, parent, seen));

  return [...inherited, ...own];
}

/** A word that names a value rather than an object a reader would want opened. */
const PLAIN_VALUE = /^(string|number|boolean|bigint|null|undefined|unknown|never|void|'\w+')$/u;

/**
 * What one field's type text leads to: the names of the objects it points at, and the keys of an
 * object spelled out in place.
 *
 * A union is split rather than matched whole, because `SlotDenialCode | null` and `CatalogLesson[]`
 * both describe the same shape to a caller as the thing inside them.
 */
function pointeesOf(index: TypeIndex, text: string): { names: string[]; fields: ResponseField[] } {
  const trimmed = text.trim();

  if (trimmed.startsWith('{')) {
    return { names: [], fields: parseTypeFields(trimmed.slice(1, trimmed.lastIndexOf('}'))) };
  }

  const names = trimmed
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !PLAIN_VALUE.test(part))
    .map((part) => {
      const { name, entry } = namedType(index, part);

      return entry?.kind === 'interface' ? name : undefined;
    })
    .filter((name): name is string => name !== undefined);

  return { names, fields: [] };
}

/**
 * Every object one answer reaches through, in the order the answer meets them.
 *
 * The walk is transitive with a set of names already shown, which is what both ends the risk: a
 * `Course` whose modules hold lessons holds the lesson keys three names deep, and a type that ever
 * points back at itself would otherwise be walked for as long as the page had patience.
 */
function reachableTypes(index: TypeIndex, shape: ResponseShape): ResponseTypeDoc[] {
  const found: ResponseTypeDoc[] = [];
  const seen = new Set<string>([shape.declared]);
  const queue: ResponseField[] = [...shape.fields];

  while (queue.length > 0) {
    const field = queue.shift();
    if (!field) continue;

    const { names, fields } = pointeesOf(index, field.type);

    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);

      const entry = index[name];

      if (entry?.kind !== 'interface') continue;

      const allFields = flattenFields(index, name, new Set());
      found.push({ name, note: entry.note, fields: allFields });
      queue.push(...allFields);
    }

    queue.push(...fields);
  }

  return found;
}

/** A handler's own text: the decorators above it and the signature it opens with. */
function handlerBlock(source: string, handlerName: string): { before: string; at: number } {
  const pattern = new RegExp(`^ {2}(?:readonly\\s+)?(?:async\\s+)?${handlerName}\\s*[(<]`, 'mu');
  const match = pattern.exec(source);

  if (!match) {
    throw new Error(`No handler named "${handlerName}" was found in the controller source`);
  }

  // Everything back to the previous method's closing brace: the decorators above a handler belong
  // to it, and one of them may say the route writes the response itself.
  const before = source.slice(0, match.index);
  const previousClose = before.lastIndexOf('\n  }');
  const previousClassClose = before.lastIndexOf('\n}');
  const cut = Math.max(previousClose, previousClassClose);

  return { before: cut === -1 ? before : before.slice(cut), at: match.index };
}

/** A handler's parameter list and the `Promise<…>` it declares, or nothing when it says no more. */
function signatureOf(source: string, at: number): { params: string; returned?: string } {
  let depth = 0;
  let index = at;

  for (; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  const paramsEnd = index;
  let angles = 0;
  const annotationStart = index + 1;

  for (index += 1; index < source.length; index += 1) {
    if (source[index] === '<') angles += 1;
    if (source[index] === '>' && angles > 0) angles -= 1;
    if (source[index] === '{' && angles === 0) break;
  }

  const annotation = source.slice(annotationStart, index).trim();

  return {
    params: source.slice(at, paramsEnd + 1),
    returned: annotation.match(/^:\s*Promise<([\s\S]*)>$/u)?.[1]?.trim(),
  };
}

let controllerFiles: Map<string, string> | undefined;

/** Every controller class in the API, by name, with the source that declares it. */
function controllerSources(): Map<string, string> {
  if (controllerFiles) return controllerFiles;

  const found = new Map<string, string>();

  for (const path of typeFiles(API_SRC_DIR)) {
    if (!path.endsWith('.controller.ts')) continue;

    const source = readSource(path);
    const name = source.match(/export class (\w+)/u)?.[1];

    if (name) found.set(name, source);
  }

  controllerFiles = found;

  return found;
}

/**
 * What one deployed handler answers with.
 *
 * The controller and handler names come from the same Nest metadata the route table is built from,
 * so this half of the page is tied to the route that is actually served rather than to a list of
 * shapes somebody kept current by hand.
 */
export function resolveResponse(controllerName: string, handlerName: string): ResponseRecord {
  const source = controllerSources().get(controllerName);

  if (!source) {
    throw new Error(`No controller source declares the class "${controllerName}"`);
  }

  const { before, at } = handlerBlock(source, handlerName);
  const { params, returned } = signatureOf(source, at);

  if (returned === undefined) {
    throw new Error(
      `${controllerName}.${handlerName} declares no return type for this read to follow`,
    );
  }

  if (returned === 'void') {
    // A handler that took the response object without asking to pass it through is writing the
    // status, the headers and the bytes itself, so no list of keys could describe the answer.
    const taken = /@Res\(([^)]*)\)/u.exec(`${before}\n${params}`);
    const takesOver = taken !== null && !taken[1]?.includes('passthrough');

    return {
      kind: takesOver ? 'stream' : 'none',
      declared: 'none',
      note: '',
      fields: [],
      types: [],
    };
  }

  const shape = shapeOf(buildTypeIndex(), returned);

  return { kind: 'json', ...shape, types: reachableTypes(buildTypeIndex(), shape) };
}
