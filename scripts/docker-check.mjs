#!/usr/bin/env node
/**
 * The container graph, checked against the repository it is supposed to run.
 *
 * A Dockerfile goes stale in a way a build never reports: a new workspace member simply does not
 * appear in the stack, and a portal that starts reading one more `NEXT_PUBLIC_*` key keeps building
 * an image that hard-codes the old answer. Both look like success because the image builds.
 *
 * So this reads the two sources of truth against each other — `apps/*` and `packages/*` on one side,
 * `compose.yaml` and `docker/*.Dockerfile` on the other — and fails on the gap. It needs no Docker
 * daemon, which is the point: it belongs in the ordinary gate, not in a deploy job.
 *
 *     node scripts/docker-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');
const exists = (relative) => existsSync(join(root, relative));

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

// --- the workspace, as the repository declares it ---------------------------------------------

const workspaceMembers = readdirSync(join(root, 'apps')).filter((name) =>
  exists(join('apps', name, 'package.json')),
);
const portalMembers = workspaceMembers.filter(
  (name) => name !== 'api' && exists(join('apps', name, 'next.config.ts')),
);
const uiPackage = exists(join('packages', 'ui', 'package.json'));

// --- the files a containerized stack needs ---------------------------------------------------

for (const required of [
  'compose.yaml',
  '.dockerignore',
  'docker/api.Dockerfile',
  'docker/portal.Dockerfile',
  'docker/site.Dockerfile',
  'docker/gateway/Dockerfile',
  'docker/gateway/nginx.conf',
]) {
  check(exists(required), `${required} does not exist`);
}

if (failures.length > 0) report();

const compose = read('compose.yaml');
const apiImage = read('docker/api.Dockerfile');
const portalImage = read('docker/portal.Dockerfile');
const siteImage = read('docker/site.Dockerfile');
const gateway = read('docker/gateway/nginx.conf');

const composeHasService = (name) => new RegExp(`^  ${name}:$`, 'm').test(compose);

// --- every app is in the stack ---------------------------------------------------------------

for (const member of workspaceMembers) {
  check(
    composeHasService(member) || (member === 'site' && composeHasService('site')),
    `apps/${member} has no service in compose.yaml — a new app that nobody can run in a container`,
  );
}
for (const name of ['postgres', 'gateway']) {
  check(composeHasService(name), `compose.yaml has no ${name} service`);
}

// The two packages the apps compile from source have to be in the build context, or every image
// fails at the first import and the error names a file that clearly exists on disk.
for (const pack of ['shared', 'ui']) {
  if (!exists(join('packages', pack))) continue;
  check(
    !/^packages\/\w+\/node_modules/m.test(read('.dockerignore')),
    `.dockerignore excludes a packages/*/node_modules the portal builds need (ui: ${uiPackage})`,
  );
}

// --- the API origin a portal ships with is chosen at build time -------------------------------

// Next inlines NEXT_PUBLIC_* into the client bundle while `next build` runs. A compose `environment:`
// entry for one of them changes nothing, so each key must reach the build as a build arg — and the
// gateway's own origin has to be the default, or a rebuilt image points a browser at a port nobody
// publishes.
const publicEnvKeys = new Set();
for (const portal of portalMembers) {
  const source = [
    ...(exists(join('apps', portal, 'lib')) ? readdirSync(join(root, 'apps', portal, 'lib')) : []),
  ]
    .filter((file) => file.endsWith('.ts'))
    .map((file) => read(join('apps', portal, 'lib', file)))
    .join('\n');
  for (const [, key] of source.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
    publicEnvKeys.add(key);
  }
}

check(publicEnvKeys.size > 0, 'no NEXT_PUBLIC_* keys found to check — the scanner is broken');
for (const key of publicEnvKeys) {
  const reachable =
    new RegExp(`ARG ${key}\\b`).test(portalImage) || new RegExp(`ARG ${key}\\b`).test(siteImage);
  const passed = new RegExp(`--build-arg ${key}[=\\s]`).test(compose) || reachable;
  check(
    reachable && passed,
    `${key} is read by a portal but is not a build ARG — the image would bake whatever was set when it was built`,
  );
}

// --- the gateway routes what the stack serves -------------------------------------------------

for (const host of ['teacher', 'student', 'ops', 'site', 'api']) {
  check(
    new RegExp(`server_name ${host}\\.localtest\\.me`).test(gateway),
    `docker/gateway/nginx.conf has no server block for ${host}.localtest.me`,
  );
}
for (const host of ['teacher', 'student', 'ops']) {
  check(
    new RegExp(`proxy_pass\\s+http://${host}`).test(gateway),
    `docker/gateway/nginx.conf does not proxy ${host}.localtest.me to the ${host} service`,
  );
}

// --- one door, and only one -------------------------------------------------------------------

// The gateway exists so a browser needs nothing but a hostname. Every published port is a way to get
// round it — and a container database on 5432 collides with the server the host's own suites use.
const published = [...compose.matchAll(/-\s+'(\d+):\d+'/g)].map(([, host]) => host);
check(
  published.length === 1 && published[0] === '80',
  `compose.yaml publishes ${published.length ? published.join(', ') : 'nothing'} — the gateway on :80 is the only port a browser should need, and 5432 belongs to the host's own Postgres`,
);

// --- nothing secret rides in an image or a committed example ----------------------------------

const dockerignore = read('.dockerignore');
for (const ignored of ['.env', '.env.*', 'apps/api/storage', 'node_modules', '.next']) {
  check(
    dockerignore.includes(ignored),
    `.dockerignore does not exclude ${ignored} — build context is where a secret becomes an image layer`,
  );
}

// The API binds 127.0.0.1 by default, which is right on a laptop and fatal in a container: nothing
// else on the network can reach it. The host therefore has to be a value the image can set.
const envSource = read('apps/api/src/config/env.ts');
check(
  /LISTEN_HOST/.test(envSource),
  'apps/api/src/config/env.ts has no LISTEN_HOST, so the API cannot be reachable from another container',
);
check(
  /LISTEN_HOST/.test(apiImage) || /LISTEN_HOST/.test(compose),
  'neither docker/api.Dockerfile nor compose.yaml sets LISTEN_HOST — the api service would start and answer nothing',
);

// Migrations ride with the API image, and prisma is a devDependency: the runtime stage must carry the
// CLI and the migrations directory or `deploy` has nothing to run.
check(
  /prisma['", ]+migrate['", ]+deploy/.test(apiImage + compose),
  'nothing runs prisma migrate deploy',
);
check(
  /--frozen-lockfile/.test(apiImage + portalImage + siteImage),
  'a Dockerfile installs dependencies without --frozen-lockfile, so the image is not the lockfile',
);

// --- the build frontend is the engine's own -----------------------------------------------------

// `# syntax=docker/dockerfile:1` makes BuildKit pull the newest external frontend and run it as a
// container. On this engine (Docker 26.1, BuildKit v0.13) that container dies as it starts and every
// build ends in `failed to solve: frontend grpc server closed unexpectedly` — an error naming no file
// and pointing at nothing in the repository. The built-in frontend builds every one of these, so
// asking for another one buys nothing and costs the whole stack.
for (const [file, image] of [
  ['docker/gateway/Dockerfile', read('docker/gateway/Dockerfile')],
  ['docker/api.Dockerfile', apiImage],
  ['docker/portal.Dockerfile', portalImage],
  ['docker/site.Dockerfile', siteImage],
]) {
  check(
    !/^#\s*syntax=/im.test(image),
    `${file} pins an external # syntax frontend — this engine's built-in one is what builds these files`,
  );
}

report();

function report() {
  if (failures.length > 0) {
    console.error(`docker-check: ${failures.length} problem(s)\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('\nfix the stack, then run this again.');
    process.exit(1);
  }
  console.log(
    `docker-check: ${workspaceMembers.length} apps, ${publicEnvKeys.size} build-time keys, ` +
      'one gateway, no secrets in the context',
  );
}
