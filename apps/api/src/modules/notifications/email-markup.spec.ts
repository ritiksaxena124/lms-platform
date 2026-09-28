import { describe, expect, it } from 'vitest';

import { renderEmail } from './render-email';

const rendered = renderEmail({
  template: {
    subject: 'A minute has been asked for',
    heading: 'Rohan Mehta wants a class',
    bodyLines: ['They asked for {when}, on {course}.'],
    ctaLabel: 'Answer the request',
  },
  payload: { when: 'Monday 28 September, 09:30', course: 'Fractions, the slow way' },
  action: { href: 'http://teacher.localtest.me:3000/requests' },
});

const html = rendered.html;

/**
 * The markup half of the same renderer, asserted on the document a mail client will actually open.
 *
 * Phase 6 chose "layout in code" over a finished HTML document in a row for exactly this reason:
 * Outlook's Word engine, Gmail's clipper and Apple Mail's dark-mode inversion each break a
 * different modern-CSS habit, and the rules that survive all of them are old ones — tables, inline
 * styles, a width written as an attribute, and no image that needs a URL to load from. Each
 * assertion below is one of those rules, so the primitives cannot drift back into the habits the
 * portals use (§15) without one of them failing.
 */
describe('the rendered document is one a mail client will open', () => {
  it('is a complete document that declares its character set and viewport', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    // Without the viewport meta a phone renders the 600px column shrunk to a thumbnail of itself.
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html.endsWith('</html>')).toBe(true);
  });

  it('lays the message out with tables, and says so on each one', () => {
    const tables = html.match(/<table\b[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    // `role="presentation"` tells a screen reader the table is spacing, not data — the one
    // accessibility cost of the layout choice Outlook forces on every renderer.
    expect(tables.every((tag) => tag.includes('role="presentation"'))).toBe(true);
  });

  it('writes a width as an attribute as well as a style, because Outlook reads the attribute', () => {
    // 600px is the convention precisely because Outlook's desktop pane and a phone are both
    // narrower than that; a wider column is read as a horizontal scroll.
    expect(html).toContain('width="600"');
    expect(html).toContain('max-width:600px');
  });

  it('styles nothing by class and nothing from a stylesheet', () => {
    // Every rule has to travel with the element it applies to: some clients drop a `<style>`
    // block, and a `class` here would point at a stylesheet that does not exist in a mailbox.
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sclass="/i);
  });

  it('uses no layout method a mail client is known to ignore', () => {
    expect(html).not.toMatch(
      /display:\s*flex|display:\s*grid|position:\s*(absolute|fixed|relative)/i,
    );
  });

  it('names no image, and no background that would have to be fetched', () => {
    // Two reasons, both decided in Phase 6: SVG renders badly or is blocked outright, and a
    // hosted PNG needs a public URL — which §6 refuses for gated bytes, and which a mailbox would
    // anyway report a recipient's reading of the message back to whoever served the file.
    expect(html).not.toMatch(/<img|background-image|url\(/i);
  });

  it('asks for a font every client already has, rather than the one the portals use', () => {
    // Inter is self-hosted in the apps (§15) and does not exist in a mail client; naming it here
    // would be a declaration nobody can honour.
    expect(html).not.toMatch(/Inter/i);
    expect(html).toMatch(/font-family:\s*-apple-system/i);
    expect(html).toMatch(/sans-serif/i);
  });

  it('builds the action as a table cell the reader can click, in the palette the app uses', () => {
    expect(html).toContain('href="http://teacher.localtest.me:3000/requests"');
    // The button is the app's own primary-action colour with white text — the pair the tokens call
    // AA-legible — rather than a colour invented for mail.
    expect(html).toContain('#0a6b52');
    expect(html).toContain('color:#ffffff');
    expect(html).toContain('>Answer the request</a>');
  });

  it('says who the message is from, in words rather than in a logo', () => {
    expect(html).toContain('LMS');
  });

  it('leaves nothing behind that asks the reader to run JavaScript', () => {
    // The renderer is React, and React is normally a promise about the browser. Static markup is
    // the half of it that keeps that promise empty: no hydration markers, no runtime, no script.
    expect(html).not.toMatch(/<script|data-react|__next/i);
  });
});
