/*
 * Copies the Open Peeps vectors into each portal's `public/` folder.
 *
 * The package owns the assets (illustrations/) because Storybook serves them
 * straight from there; a Next app can only serve files from its own public/,
 * so this keeps the two in step. Run it after adding or renaming an artwork.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const source = join(repoRoot, 'packages/ui/illustrations');

const PORTALS = [
  { name: 'teacher', dir: join(repoRoot, 'apps/teacher/public/illustrations') },
  { name: 'student', dir: join(repoRoot, 'apps/student/public/illustrations') },
  // ops gets the same line when its app exists.
];

for (const portal of PORTALS) {
  mkdirSync(portal.dir, { recursive: true });
  const files = readdirSync(source).filter((name) => name.endsWith('.svg'));
  for (const name of files) {
    copyFileSync(join(source, name), join(portal.dir, name));
  }
  console.log(`${portal.name}: ${String(files.length)} illustrations → ${portal.dir}`);
}
