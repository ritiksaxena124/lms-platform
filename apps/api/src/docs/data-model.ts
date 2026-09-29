import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The schema file, read as text rather than through a Prisma parser dependency.
 *
 * This export answers one question — what shape does the data live in — and the schema is the only
 * place that answer is written down. Booting the client to ask it would mean a database to connect
 * to, and a public documentation page has no business depending on one being reachable.
 */
const SCHEMA_PATH = resolve(process.cwd(), 'prisma/schema.prisma');

/** A column, as the row holds it and as the database names it. */
export interface ModelColumn {
  name: string;
  /** The `@map` name, which is what a reader sees in a raw query or in a log row's `targetTable`. */
  column: string;
  /** Prisma's type token, with `[]` kept when the column holds a list. */
  type: string;
  optional: boolean;
}

/** A pointer this row holds: the field that names it, the row it leads to, the column carrying it. */
export interface ModelRelation {
  field: string;
  type: string;
  /** The local columns the foreign key lives in — usually one, and named rather than inferred. */
  columns: string[];
  /** What the database does when the row pointed at goes away. */
  onDelete: string;
}

export interface ModelDoc {
  name: string;
  /** The `@@map` table name. A model without one is this export inventing a table. */
  table: string;
  columns: ModelColumn[];
  relations: ModelRelation[];
  /** Each set of fields that cannot repeat, from a field's own `@unique` or a `@@unique` block. */
  uniqueKeys: string[][];
  /** Whether the row can be retired without deleting it — the convention every table but one keeps. */
  softDelete: boolean;
  /** Whether the row carries `@updatedAt`, which a ledger must not. */
  tracksUpdates: boolean;
}

interface FieldLine {
  name: string;
  type: string;
  optional: boolean;
}

/**
 * The `model X { … }` bodies, in the order the schema writes them.
 *
 * That order is not accidental — a table is declared after the ones it points at — so it is kept
 * rather than sorted alphabetically, and a reader of the page meets the reference data before the
 * rows that use it.
 */
function modelBlocks(source: string): { name: string; lines: string[] }[] {
  const blocks: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const opening = /^model\s+([A-Za-z0-9_]+)\s*\{\s*$/.exec(rawLine);

    if (opening) {
      current = { name: group(opening, 1), lines: [] };
      blocks.push(current);
      continue;
    }

    if (/^\}/.test(rawLine)) {
      current = undefined;
      continue;
    }

    if (current) current.lines.push(rawLine.trim());
  }

  return blocks;
}

/**
 * A capture group, read through one door: the patterns below are written so that a match always
 * carries the group this asks for, which is a fact the compiler cannot see.
 */
function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? '';
}

/** `field Type …`, where the type may carry `[]` for a list or `?` for nullable. */
function parseField(line: string): FieldLine | undefined {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?(\s|$)/.exec(line);

  if (!match) return undefined;

  return {
    name: group(match, 1),
    type: `${group(match, 2)}${match[3] ?? ''}`,
    optional: match[4] === '?',
  };
}

function mappedTo(line: string): string | undefined {
  return /@map\(\s*"([^"]+)"\s*\)/.exec(line)?.[1];
}

/**
 * A pointer is a field whose type is another model and which names the columns the key lives in.
 * The other half of every pair — `courses Course[]`, which holds no key — is the same fact read from
 * the far side, so both are recognised here and only the owning half is kept: a page built from the
 * pointers says who points at a table without any row stating it twice.
 */
function parseRelation(line: string, modelNames: Set<string>): ModelRelation | undefined {
  const field = parseField(line);

  if (!field || !modelNames.has(field.type.replace(/\[\]$/, ''))) return undefined;

  const fields = /fields:\s*\[([^\]]*)\]/.exec(line);

  if (!fields) return undefined;

  return {
    field: field.name,
    type: field.type,
    columns: group(fields, 1)
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    onDelete: /onDelete:\s*([A-Za-z]+)/.exec(line)?.[1] ?? 'not stated',
  };
}

/** A block `@@unique([a, b])`, or the one-field key a column's own `@unique` makes. */
function parseUniqueKey(line: string, field: FieldLine | undefined): string[] | undefined {
  const block = /^@@unique\(\[([^\]]*)\]/.exec(line);

  if (block) {
    return group(block, 1)
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  }

  if (field && /@unique(\s|\(|$)/.test(line)) return [field.name];

  return undefined;
}

function readBlock(block: { name: string; lines: string[] }, modelNames: Set<string>): ModelDoc {
  const columns: ModelColumn[] = [];
  const relations: ModelRelation[] = [];
  const uniqueKeys: string[][] = [];
  let table = block.name;
  let tracksUpdates = false;

  for (const line of block.lines) {
    // The design notes a model carries are prose for whoever edits the schema, not columns.
    if (line.startsWith('//') || line.length === 0) continue;

    if (line.startsWith('@@')) {
      const key = parseUniqueKey(line, undefined);

      if (key) uniqueKeys.push(key);
      table = mappedTo(line) ?? table;
      continue;
    }

    const field = parseField(line);

    if (!field) continue;

    // A field naming another model is a relation, not a column: it holds no value of its own. The
    // owning half carries the key and is kept below; the far half is the same pair seen backwards.
    if (modelNames.has(field.type.replace(/\[\]$/, ''))) {
      const relation = parseRelation(line, modelNames);

      if (relation) relations.push(relation);
      continue;
    }

    const key = parseUniqueKey(line, field);

    if (key) uniqueKeys.push(key);
    if (line.includes('@updatedAt')) tracksUpdates = true;

    columns.push({
      name: field.name,
      column: mappedTo(line) ?? field.name,
      type: field.type,
      optional: field.optional,
    });
  }

  return {
    name: block.name,
    table,
    columns,
    relations,
    uniqueKeys: uniqueKeys.filter((key) =>
      key.every((name) => columns.some((column) => column.name === name)),
    ),
    softDelete: columns.some((column) => column.name === 'isActive'),
    tracksUpdates,
  };
}

export function collectModels(): ModelDoc[] {
  const blocks = modelBlocks(readFileSync(SCHEMA_PATH, 'utf8'));
  const modelNames = new Set(blocks.map((block) => block.name));

  return blocks.map((block) => readBlock(block, modelNames));
}

export function renderDataModel(): string {
  return `${JSON.stringify(
    {
      // Read this file only as the output of a command, and regenerate it rather than editing it:
      // the drift test in `data-model.spec.ts` compares it against the schema.
      generatedBy: 'bun run --filter @lms/api docs:data',
      models: collectModels(),
    },
    null,
    2,
  )}\n`;
}
