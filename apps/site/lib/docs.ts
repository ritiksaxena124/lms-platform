import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Marked, type Tokens } from 'marked';

export interface DocEntry {
  /** The heading this page sits under in the contents. Groups appear in first-mention order. */
  group: string;
  /** The URL segment and the filename, without `.md`. Keeping them one value is the drift guard. */
  slug: string;
  title: string;
  summary: string;
}

export interface DocGroup {
  group: string;
  entries: DocEntry[];
}

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

export interface DocPage {
  entry: DocEntry;
  html: string;
  /** Sections the reader can be sent to — `##` and below. The page's own `#` is its title. */
  headings: DocHeading[];
}

const CONTENT_DIR = resolve(process.cwd(), 'content');

/**
 * The manifest is read rather than imported so that a page can be added by writing a file and a
 * line here, with no third place to remember.
 */
const ENTRIES = JSON.parse(readFileSync(resolve(CONTENT_DIR, 'docs.json'), 'utf8')) as DocEntry[];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Ids have to be stable across builds and unique within a page. A reader sent to `#the-api` should
 * land on the section they were promised even after a second heading with the same words is added
 * above it, so the collision is resolved by position rather than by a hash of the content.
 */
function uniqueId(base: string, seen: Set<string>): string {
  const root = base || 'section';
  let id = root;
  let taken = 2;

  while (seen.has(id)) {
    id = `${root}-${taken}`;
    taken += 1;
  }
  seen.add(id);
  return id;
}

type HeadingWithId = Tokens.Heading & { id?: string };

const marked = new Marked({ gfm: true });

marked.use({
  renderer: {
    heading(token) {
      const heading = token as HeadingWithId;
      const id = heading.id ?? slugify(heading.text);
      return `<h${heading.depth} id="${id}">${marked.parseInline(heading.text, { async: false })}</h${heading.depth}>`;
    },
  },
});

export function docSlugs(): string[] {
  return ENTRIES.map((entry) => entry.slug);
}

/**
 * Every path the export emits for the docs, and the only list an internal link on this site is
 * allowed to point at. The index is deliberately given the short path rather than also appearing
 * as `/docs/index`: two URLs for one page is two things that can drift, and one of them would be
 * a link nobody wrote on purpose.
 */
export function docRoutes(): string[] {
  return [
    '/docs',
    ...ENTRIES.filter((entry) => entry.slug !== 'index').map((entry) => `/docs/${entry.slug}`),
  ];
}

export function docGroups(): DocGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, DocEntry[]>();

  for (const entry of ENTRIES) {
    const existing = byGroup.get(entry.group);
    if (existing) {
      existing.push(entry);
    } else {
      byGroup.set(entry.group, [entry]);
      order.push(entry.group);
    }
  }

  return order.map((group) => ({ group, entries: byGroup.get(group) as DocEntry[] }));
}

export function readDoc(slug: string): DocPage {
  const entry = ENTRIES.find((candidate) => candidate.slug === slug);

  if (!entry) {
    throw new Error(`No docs page "${slug}": content/docs.json does not list it`);
  }

  const path = resolve(CONTENT_DIR, `${slug}.md`);
  if (!existsSync(path)) {
    throw new Error(
      `content/docs.json lists "${slug}" but content/${slug}.md is not there — the manifest and the folder have drifted`,
    );
  }

  const tokens = marked.lexer(readFileSync(path, 'utf8'));
  const seen = new Set<string>();
  const headings: DocHeading[] = [];

  for (const token of tokens) {
    if (token.type !== 'heading') continue;

    const heading = token as HeadingWithId;
    heading.id = uniqueId(slugify(heading.text), seen);
    if (heading.depth >= 2) {
      headings.push({ depth: heading.depth, text: heading.text, id: heading.id });
    }
  }

  return { entry, html: marked.parser(tokens), headings };
}
