#!/usr/bin/env node
/**
 * test-archive-dirs.mjs — every archived source family has a folder to land in.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-archive-dirs.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> THE BUG THIS EXISTS FOR. <== `tools/archive-fetch.mjs` writes each source
 * to `join(OUT, r.name)`, and a `name` may carry a folder prefix —
 * `geometry/…`, `ships/…`, `jtwc/…`, `adeck/…`. Node does NOT create an
 * intermediate directory on write, so a family whose folder was never mkdir'd
 * throws ENOENT on its first source.
 *
 * On 2026-08-21 the a-deck family shipped without its `mkdirSync` line. The
 * phase's own try/catch — which is there so an experiment can never cost us a
 * storm list — swallowed the ENOENT, the run reported `68/69 sources ok`, and
 * model guidance went unarchived every hour while nothing anywhere said so.
 * A whole session was planned around bytes that were never captured.
 *
 * ==> IT IS A STATIC CHECK, AND IT HAS TO BE. <== Proving this at runtime means
 * running the fetcher, and the fetcher needs the open internet the dev sandbox
 * does not have (§18). The relationship being guarded is between two lines of
 * one file, so reading that file is the honest way to check it: a source name
 * with a slash in it, and no matching mkdir, is the whole fault.
 *
 * The companion guard is `derivedFailures` in the manifest, which makes a
 * swallowed phase VISIBLE after the fact. This one makes it not happen.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };

const SRC = 'tools/archive-fetch.mjs';
const src = readFileSync(SRC, 'utf8');

/* Every `name:` that carries a folder prefix. Both quoting styles, because the
 * fixed names are single-quoted and the derived ones are template literals. */
const named = [...src.matchAll(/name:\s*[`'"]([a-z][a-z0-9-]*)\//g)].map((m) => m[1]);
const families = [...new Set(named)].sort();

/* Every folder the script creates under OUT. */
const made = [...src.matchAll(/mkdirSync\(join\(OUT,\s*'([^']+)'\)/g)].map((m) => m[1]);
const dirs = new Set(made);

console.log(`\n  ${SRC}`);
console.log(`  source families: ${families.join(', ') || '(none)'}`);
console.log(`  folders created: ${[...dirs].sort().join(', ') || '(none)'}`);

ok(families.length >= 4,
   `found ${families.length} prefixed source families — the scan is still matching real names`);

for (const fam of families) {
  ok(dirs.has(fam),
     `'${fam}/' sources have a mkdirSync — without it the first write throws ENOENT ` +
     'and the phase\u2019s try/catch hides it');
}

/* The other half of the same rule: a folder made for nothing is dead code, and
 * dead code here is a family somebody deleted without deleting its folder. */
for (const dir of dirs) {
  ok(families.includes(dir),
     `'${dir}/' is created and something still writes to it`);
}

/* ==> A DERIVED PHASE MUST REPORT, NOT SHRUG. <== Every `try` around a derived
 * phase catches, by design. What is not allowed is catching QUIETLY: the catch
 * has to leave a trace a session can read out of the manifest. */
const catches = [...src.matchAll(/\}\s*catch\s*\(err\)\s*\{([\s\S]{0,200}?)\n\}/g)].map((m) => m[1]);
ok(catches.length >= 6, `found ${catches.length} derived-phase catch blocks`);
for (const [i, body] of catches.entries()) {
  ok(/phaseFailed\(/.test(body),
     `derived catch #${i + 1} routes through phaseFailed, so the failure reaches manifest.json`);
}
ok(/derivedFailures,/.test(src),
   'and derivedFailures is written into the manifest, where a session can git show it');

if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
