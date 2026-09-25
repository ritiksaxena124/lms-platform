import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ['tokens.css', 'base.css', 'motion.css', 'index.css'];

/**
 * A `var()` with no fallback is not a no-op when the custom property is only
 * ever set by a consumer: if nobody sets it, the whole declaration becomes
 * invalid at computed-value time and the property drops to its initial value.
 * `--font-sans` doing that rendered every portal in the browser's default serif
 * while Storybook, which sets its own body font, looked perfect.
 */
function danglingVars(css: string) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];

  for (const match of withoutComments.matchAll(/var\(\s*--[a-zA-Z0-9-]+\s*\)/g)) {
    const after = withoutComments.slice(match.index + match[0].length).trimStart();
    if (after.startsWith(',')) found.push(match[0]);
  }
  return found;
}

describe('style sheets', () => {
  it.each(FILES)('%s has no var() list item without a fallback', (file) => {
    const css = readFileSync(join(HERE, file), 'utf8');
    expect(danglingVars(css)).toEqual([]);
  });
});
