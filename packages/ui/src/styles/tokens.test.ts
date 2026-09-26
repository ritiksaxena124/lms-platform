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

/** The tokens a portal paints text with, read straight out of the sheet. */
function token(name: string): string {
  const property = name.startsWith('--') ? name : `--${name}`;
  const css = readFileSync(join(HERE, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const match = new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!match?.[1]) throw new Error(`${property} is not a six-digit hex in tokens.css`);
  return match[1];
}

/** WCAG 2.2 relative luminance, then the contrast ratio between two colors. */
function luminance(hex: string): number {
  const channels = [16, 8, 0].map((shift) => (parseInt(hex.slice(1), 16) >> shift) & 0xff);
  const linear = channels.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = linear as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The two backgrounds a portal paints readable text on. `--color-paper-sunk` is left out on
 * purpose: it is the well behind disabled fields and code blocks, and text that is disabled is
 * exempt from the bar by definition — judging the ramp against it would only push every gray
 * toward black. */
const SURFACES = ['--color-surface', '--color-paper'] as const;

describe('type tokens', () => {
  /**
   * A font is only as crisp as its weakest gray. These are the colors the kit paints at
   * 12–13px — hints, metadata, timestamps, links — and 4.5:1 is the bar below which that
   * text stops being readable at a glance and starts being something you squint at.
   *
   * The check reads the sheet rather than a copy of the values, because the whole point is
   * that nobody lightens one of these by eye six months from now.
   */
  it.each([
    '--color-ink',
    '--color-ink-strong',
    '--color-ink-muted',
    '--color-ink-faint',
    '--color-brand',
    '--color-brand-deep',
    '--color-danger',
    '--color-success',
    '--color-warning',
    '--color-info',
  ])('%s keeps AA contrast on every surface', (name) => {
    const ratios = SURFACES.map((surface) => contrast(token(name), token(surface.slice(2))));
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  /** AA is a floor, not a destination: if the lightest gray were simply darkened into the
   * one below it, the ramp would pass and every screen would come out one flat tone. */
  it('keeps the ink ramp in order', () => {
    const rank = (name: string) => luminance(token(name));
    expect(rank('color-ink-faint')).toBeGreaterThan(rank('color-ink-muted'));
    expect(rank('color-ink-muted')).toBeGreaterThan(rank('color-ink'));
    expect(rank('color-ink')).toBeGreaterThan(rank('color-ink-strong'));
  });

  /**
   * `base.css` asks for optical sizing, and an Inter file with only the weight axis cannot
   * answer — the declaration would sit there quietly doing nothing while every 12–15px label
   * rendered with 14–32pt spacing, which is exactly the soft, loose look it was written to
   * avoid. So the axis the sheet requests has to be the axis the sheet loads.
   */
  it('loads the Inter build that carries the axis base.css requests', () => {
    const entry = readFileSync(join(HERE, 'index.css'), 'utf8');
    const base = readFileSync(join(HERE, 'base.css'), 'utf8');
    expect(base).toContain('font-optical-sizing: auto');
    const loaded = /@fontsource-variable\/inter\/([a-z-]+)\.css/.exec(entry)?.[1];
    expect(loaded).toBeDefined();
    expect(loaded).not.toBe('wght');
  });
});

describe('style sheets', () => {
  it.each(FILES)('%s has no var() list item without a fallback', (file) => {
    const css = readFileSync(join(HERE, file), 'utf8');
    expect(danglingVars(css)).toEqual([]);
  });
});
