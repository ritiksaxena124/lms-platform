#!/usr/bin/env node
/**
 * Cut a release: verify the tree, tag it, push both halves, publish the notes.
 *
 *     node scripts/release.mjs v0.5.0 --title "Phase 5: live classes and recordings"
 *     bun run release v0.5.0 --notes "What a person gets at this tag."
 *
 * A tag means "this passed `bun run verify`", so the gate runs first and a failure stops
 * before anything is written. Nothing here guesses at a version: the tag is an argument, and
 * the tag is annotated rather than lightweight, because a phase boundary is a decision with a
 * reason behind it and `git tag -m` is where that reason belongs.
 *
 * Pushing is the irreversible half, so it comes last and only once the tag exists locally.
 * `--dry-run` walks every step and runs none of them.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const tag = args.find((a) => !a.startsWith('--'));
const option = (name) => {
  const value = args.find((a) => a.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : null;
};
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...rest) => execFileSync('git', rest, { cwd: root, encoding: 'utf8' }).trim();
const branch = 'main';

function fail(message) {
  console.error(`\nrelease stopped: ${message}\n`);
  process.exit(1);
}

function step(command, commandArgs, { gate = false } = {}) {
  console.log(`\n$ ${[command, ...commandArgs].join(' ')}`);
  if (dryRun) return;
  try {
    execFileSync(command, commandArgs, {
      cwd: root,
      stdio: gate ? 'inherit' : 'ignore',
      encoding: 'utf8',
    });
  } catch {
    fail(
      command === 'bun'
        ? 'verify is not green. Nothing was tagged — fix the gate, then run this again.'
        : `${command} ${commandArgs[0] ?? ''} did not succeed`,
    );
  }
}

if (!tag || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
  fail(`pass a version tag like v0.5.0 (or v0.5.0-rc.1). Got: ${tag ?? 'nothing'}`);
}

const title = option('title') ?? tag;
const notes = option('notes');
const dryRun = flags.has('--dry-run');

if (git('status', '--porcelain'))
  fail('the working tree has uncommitted changes — commit or stash them first');
const head = git('rev-parse', '--abbrev-ref', 'HEAD');
if (head !== branch) fail(`a release is cut from ${branch}, not ${head}`);
if (git('tag', '-l', tag)) fail(`${tag} already exists locally`);
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) fail(`${tag} is already on origin`);

console.log(`release ${tag} from ${git('rev-parse', '--short', 'HEAD')} on ${branch}`);

if (flags.has('--skip-verify')) {
  console.log('\nskipping the gate — a tag with no `verify` behind it is a label, not a release');
} else {
  step('bun', ['run', 'verify'], { gate: true });
}

step('git', ['tag', '-a', tag, '-m', title, ...(notes ? ['-m', notes] : [])]);
step('git', ['push', 'origin', branch]);
step('git', ['push', 'origin', tag]);

// `--verify-tag` asks origin for the tag rather than trusting the push two lines above.
step(
  'gh',
  [
    'release',
    'create',
    tag,
    '--title',
    title,
    '--verify-tag',
    ...(notes ? ['--notes', notes] : ['--generate-notes']),
  ],
  {
    gate: true,
  },
);

console.log(`\n${tag}: https://github.com/ritiksaxena124/lms-platform/releases/tag/${tag}\n`);
