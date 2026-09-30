import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  docGroups,
  docRoutes,
  docSlugs,
  readDoc,
  type DataModelFile,
  type EndpointsFile,
} from './docs';

const CONTENT_DIR = resolve(import.meta.dirname, '../content');
const REPO_ROOT = resolve(CONTENT_DIR, '../../..');

/** The `.md` files that actually exist, as slugs. */
function filesOnDisk(): string[] {
  return readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort();
}

/**
 * The phase table, parsed by the test straight out of the repository README.
 *
 * The page reads the same file, so a guard that merely agreed with the page would prove nothing —
 * what this checks is that the renderer emitted every row the record holds, in order.
 */
function readmePhases(): { phase: string; scope: string; status: string }[] {
  const source = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

  return [...source.matchAll(/^\| (\d+)\s*\| (.+?)\s*\| (.+?)\s*\|$/gm)].map((match) => ({
    phase: match[1] ?? '',
    scope: match[2] ?? '',
    status: (match[3] ?? '').replace(/\*\*/g, ''),
  }));
}

/** Every workspace the monorepo holds, as the folder a reader would open. */
function workspaces(): string[] {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(resolve(REPO_ROOT, group))
      .filter((name) => existsSync(resolve(REPO_ROOT, group, name, 'package.json')))
      .map((name) => `${group}/${name}`)
      .sort(),
  );
}

/** The provider ports the API defines, by folder. */
function providerPorts(): string[] {
  return readdirSync(resolve(REPO_ROOT, 'apps/api/src/providers')).sort();
}

/** Every internal link in rendered markdown, anchors to another page rather than a section. */
function internalLinks(html: string): string[] {
  const hrefs: string[] = [];

  for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) {
    if (href) hrefs.push(href);
  }

  return hrefs;
}

/**
 * The README writes an apostrophe as one character; marked emits the entity HTML reserves it as.
 *
 * Comparing a cell straight against the markup would fail on `teacher's calendar` and teach the next
 * reader to trust the escape rather than the page.
 */
function asRendered(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

describe('the docs manifest', () => {
  it('names every page the content folder holds', () => {
    // A file nobody links to is a page no reader can reach, and the build will not complain:
    // it renders what the manifest lists and exports it as though that were everything.
    const listed = [...docSlugs()].sort();
    expect(listed).toEqual(filesOnDisk());
  });

  it('points at a file for every page it names', () => {
    // The other half of the pair. A manifest entry whose file was renamed away renders an empty
    // page rather than failing, which is the worst way to find out.
    for (const slug of docSlugs()) {
      expect(() => readDoc(slug)).not.toThrow();
    }
  });

  it('keeps the index as the one page reachable at /docs itself', () => {
    const groups = docGroups();

    expect(docSlugs()).toContain('index');
    expect(groups[0]?.entries[0]?.slug).toBe('index');
  });

  it('gives every page a group, a title and a line about what it answers', () => {
    for (const group of docGroups()) {
      expect(group.group).toMatch(/\S/);
      for (const entry of group.entries) {
        expect(entry.title).toMatch(/\S/);
        expect(entry.summary).toMatch(/\S/);
      }
    }
  });
});

describe('a docs page', () => {
  it('renders markdown to html', () => {
    const page = readDoc('index');

    // The title becomes an element rather than staying literal text. Not "contains no `#`":
    // the shell blocks in these pages are full of comment lines that begin with one.
    expect(page.html).toContain('<h1 id=');
    expect(page.html).toContain('</h1>');
  });

  it('gives every section an anchor a reader can be sent to', () => {
    const page = readDoc('running-it-locally');
    const depths = page.headings.map((heading) => heading.depth);

    expect(page.headings.length).toBeGreaterThan(0);
    // The file's own `#` is the page title and is not a section; the on-page contents lists
    // `##` and below, so a heading list that starts at 1 would put the title in its own index.
    expect(depths.every((depth) => depth >= 2)).toBe(true);
    for (const heading of page.headings) {
      expect(heading.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(page.html).toContain(`id="${heading.id}"`);
    }
  });

  it('refuses a slug that is not a page', () => {
    // The route calls this with a path segment from the URL. At build time an unknown segment
    // has to stop the export, not emit a page that says nothing.
    expect(() => readDoc('no-such-page')).toThrow(/no-such-page/);
  });
});

describe('the routes the export builds', () => {
  it('gives the index the short path and every other page its own', () => {
    const routes = docRoutes();

    expect(routes).toContain('/docs');
    expect(routes).not.toContain('/docs/index');
    expect(new Set(routes).size).toBe(routes.length);
    for (const slug of docSlugs()) {
      expect(routes).toContain(slug === 'index' ? '/docs' : `/docs/${slug}`);
    }
  });

  it('holds a route for every link the prose makes', () => {
    // A static export has no server to answer an unknown path, so a link is worth exactly as much
    // as the file behind it — and the build is content to emit a page full of 404s. This is the
    // only thing standing between a renamed slug and a reader who cannot leave the index.
    const built = new Set(docRoutes());
    for (const slug of docSlugs()) {
      for (const href of internalLinks(readDoc(slug).html)) {
        expect(built.has(href), `${slug}.md links ${href}, which is not a page`).toBe(true);
      }
    }
  });

  it('lands every anchor the prose points at', () => {
    // A section link that misses its heading still loads the page, so the reader arrives and finds
    // the top of a long document instead of the sentence the link promised. Renaming a heading is a
    // prose edit, and prose edits outrank the tests that were written against the old wording.
    const anchored = docSlugs().flatMap((slug) =>
      [...readDoc(slug).html.matchAll(/href="\/docs\/?([^"#]*)#([a-z0-9-]+)"/g)].map((match) => ({
        slug,
        target: match[1] ?? '',
        id: match[2] ?? '',
      })),
    );

    // Non-vacuous: the guard is only worth having while some page actually sends a reader to a
    // section rather than to a document.
    expect(anchored.length).toBeGreaterThan(0);

    for (const link of anchored) {
      const page = readDoc(link.target === '' ? 'index' : link.target);

      expect(
        page.html,
        `${link.slug} sends the reader to #${link.id}, which ${link.target} does not hold`,
      ).toContain(`id="${link.id}"`);
    }
  });
});

describe('the route table the API exports', () => {
  // Read from the file rather than from `lib/docs`, because the point of the page is that a reader
  // sees every route: a renderer that dropped a group would still look complete from the inside.
  const exported = (
    JSON.parse(
      readFileSync(resolve(CONTENT_DIR, 'endpoints.json'), 'utf8'),
    ) as unknown as EndpointsFile
  ).endpoints;

  const page = readDoc('api-reference');

  it('renders every route the app answers', () => {
    expect(exported.length).toBeGreaterThan(40);

    // Each route by name, rather than a row count: a page of prose beside the table has its own
    // code cells, and arithmetic that happens to close proves nothing about which route is missing.
    for (const endpoint of exported) {
      expect(page.html, `${endpoint.method} ${endpoint.path} is not on the page`).toContain(
        `<td><code>${endpoint.path}</code></td>`,
      );
    }
  });

  it('puts each resource in the page contents as a word, not as markup', () => {
    // The generated sections are headings so a reader can jump to `bookings`, and the on-page
    // contents prints their text raw — a backtick left in the source reaches the rail as a backtick.
    const sections = readDoc('api-reference').headings.map((heading) => heading.text);

    expect(sections).toContain('bookings');
    expect(sections.join(' ')).not.toContain('`');
  });

  it('names the access rule in words the guard actually enforces', () => {
    // The four cases the API really has, each visible on the page: a stranger's door, a door that
    // reads a session without requiring one, a role, and any signed-in account at all.
    expect(page.html).toContain('anyone');
    expect(page.html).toContain('session read if offered');
    expect(page.html).toContain('teacher');
    expect(page.html).toContain('any signed-in account');
  });

  it('leaves no marker unfilled on any page', () => {
    // A fence the renderer does not know becomes a code block that prints its own name — the worst
    // kind of stale docs, because they look like a placeholder somebody will get to.
    for (const slug of docSlugs()) {
      expect(readDoc(slug).html).not.toMatch(/language-(?:endpoints|data-model|phases)|```/);
    }
  });
});

describe('the data model the API exports', () => {
  // Read from the file rather than from `lib/docs`, because a renderer that dropped four of the
  // sixteen tables would still print a page that looks like a schema.
  const file = JSON.parse(
    readFileSync(resolve(CONTENT_DIR, 'data-model.json'), 'utf8'),
  ) as unknown as DataModelFile;

  const page = readDoc('data-model');

  it('gives every table its own section', () => {
    expect(file.models.length).toBeGreaterThan(12);

    for (const model of file.models) {
      expect(page.html, `${model.name} has no section`).toContain(
        `<h3 id="${model.name.toLowerCase()}">${model.name}</h3>`,
      );
    }
  });

  it('names every column twice, as the code calls it and as the database calls it', () => {
    // The pair is the point: `teacherUserId` is what a Prisma call writes and `teacher_user_id` is
    // what a raw query and a log row carry, and a reader holding either should find the other here.
    for (const model of file.models) {
      for (const column of model.columns) {
        expect(page.html, `${model.name}.${column.name} is not on the page`).toContain(
          `<code>${column.name}</code>`,
        );
        expect(page.html, `${model.name}.${column.column} is not on the page`).toContain(
          `<code>${column.column}</code>`,
        );
      }
    }
  });

  it('marks the columns that may hold nothing', () => {
    // A nullable column is a promise about a business rule — `slotHeldAt` is null exactly when the
    // row keeps no minute — so the page has to show which ones are optional at all.
    expect(page.html).toContain('<code>DateTime?</code>');
    expect(page.html).toContain('<code>String[]</code>');
  });

  it('states the two conventions on every table, and the exception in words', () => {
    const retireable = page.html.match(/retireable/g) ?? [];
    const unretired = page.html.match(/no retirement flag, no update stamp/g) ?? [];

    expect(retireable.length).toBe(file.models.length - 1);
    expect(unretired).toHaveLength(1);
  });

  it('lists each pointer with the row it leads to and the action behind it', () => {
    // A booking points at `users` twice, so naming the target alone would leave the reader guessing
    // which half is the student. The physical column is the answer: it is what the two rows differ in.
    expect(page.html).toContain('<code>student</code> → <code>users</code>');
    expect(page.html).toContain('from <code>student_user_id</code>');
    expect(page.html).toContain('from <code>teacher_user_id</code>');
    expect(page.html).toContain('Restrict');
  });

  it('inverts the pointers so a hub table shows who holds it', () => {
    // The schema writes each pair once, on the side that holds the key, and a reader of `users` has
    // to be shown the far halves or the busiest table on the page looks like nothing depends on it.
    expect(page.html).toContain('<code>booking</code> holds it as <code>student</code>');
  });

  it('records the keys that cannot repeat', () => {
    // The pair that keeps two learners off one minute of one teacher's calendar, and the pair that
    // makes a code mean one thing per lookup type. Neither string exists anywhere else on the page,
    // so finding them is the same as finding the key list.
    expect(page.html).toContain('<code>teacher_user_id</code> + <code>slot_held_at</code>');
    expect(page.html).toContain('<code>type_id</code> + <code>code</code>');
  });

  it('puts each table in the page contents as a word, not as markup', () => {
    const sections = page.headings.map((heading) => heading.text);

    expect(sections).toContain('Booking');
    expect(sections.join(' ')).not.toContain('`');
  });
});

describe('the guide', () => {
  const page = readDoc('guide');

  it('names every piece the monorepo holds', () => {
    // The tables on these pages are written by hand, so the check runs the other way, from the
    // folders: a workspace added to the repository has to be explained to a reader before these
    // pages are allowed to go on not mentioning it.
    const named = docSlugs()
      .map((slug) => readDoc(slug).html)
      .join('');

    expect(workspaces().length).toBeGreaterThanOrEqual(7);
    for (const workspace of workspaces()) {
      expect(named, `${workspace} is not named anywhere in the docs`).toContain(
        `<code>${workspace}</code>`,
      );
    }
  });

  it('names every port the API stands behind', () => {
    // The three folders in `apps/api/src/providers` are the whole surface the platform offers to
    // hand to somebody else's system, and a guide that leaves one out teaches the design wrongly.
    expect(providerPorts()).toHaveLength(3);

    for (const port of providerPorts()) {
      expect(page.html, `the ${port} port is not on the guide`).toContain(`<code>${port}</code>`);
    }
  });

  it('sends the reader to the pages that hold the generated facts', () => {
    // The guide explains; the tables belong to the pages the code fills in. A fourth place writing
    // out routes or columns is a copy that drifts.
    for (const href of ['/docs/api-reference', '/docs/data-model', '/docs/conventions']) {
      expect(page.html).toContain(`href="${href}"`);
    }
  });
});

describe('the phase record', () => {
  const rows = readmePhases();
  const page = readDoc('phases');

  it('publishes the table the repository keeps instead of restating it', () => {
    // Parsed from the README by the test as well as by the page, so the guard proves the renderer
    // emitted every row — not that two hand-kept copies happen to agree today.
    expect(rows).toHaveLength(13);

    for (const row of rows) {
      expect(page.html, `phase ${row.phase} lost its number`).toContain(`<td>${row.phase}</td>`);
      expect(page.html, `phase ${row.phase} lost its scope`).toContain(asRendered(row.scope));
      expect(page.html, `phase ${row.phase} lost its status`).toContain(asRendered(row.status));
    }
  });

  it('keeps the phases in the order the record sets them', () => {
    const numbers = [...page.html.matchAll(/<td>(\d+)<\/td>/g)].map((match) => match[1]);

    expect(numbers).toEqual(rows.map((row) => row.phase));
  });
});

describe('what a public page may not print', () => {
  it('keeps the seeded logins out of every page', () => {
    // The demo accounts are printed by `db:seed` and listed in the repository README, both of which
    // belong to someone sitting at their own keyboard. These pages are read by strangers, and one
    // of those accounts is an operator: a password on a public docs page is not a convenience, it
    // is a doorway.
    for (const slug of docSlugs()) {
      const { html } = readDoc(slug);

      expect(html).not.toMatch(/lms-demo-password/i);
      expect(html).not.toMatch(/@example\.test/i);
    }
  });
});
