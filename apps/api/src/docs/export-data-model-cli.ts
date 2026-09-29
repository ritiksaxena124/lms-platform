import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderDataModel } from './data-model';

/**
 * Writes the data model where the public docs read it from.
 *
 * Committed rather than generated at build time, because `apps/site` is a static export and its
 * build has no business reading the API's schema to find out what its own page should say. The cost
 * of that choice — a file that can go stale — is what the drift test in `data-model.spec.ts`
 * charges for.
 */
const TARGET = resolve(process.cwd(), '../site/content/data-model.json');

const rendered = renderDataModel();

writeFileSync(TARGET, rendered, 'utf8');

const count = (JSON.parse(rendered) as { models: unknown[] }).models.length;

console.log(`Wrote ${count} models to ${TARGET}`);
