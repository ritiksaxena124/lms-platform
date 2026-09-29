import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import 'reflect-metadata';

import { renderEndpoints } from './endpoint-reference';

/**
 * Writes the route table where the public docs read it from.
 *
 * Committed rather than generated at build time, because `apps/site` is a static export and its
 * build has no business booting a Nest application to find out what its own page should say. The
 * cost of that choice — a file that can go stale — is what the drift test in
 * `endpoint-reference.spec.ts` charges for.
 */
const TARGET = resolve(process.cwd(), '../site/content/endpoints.json');

const rendered = renderEndpoints();

writeFileSync(TARGET, rendered, 'utf8');

const count = (JSON.parse(rendered) as { endpoints: unknown[] }).endpoints.length;

console.log(`Wrote ${count} endpoints to ${TARGET}`);
