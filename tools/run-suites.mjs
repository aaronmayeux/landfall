/**
 * run-suites.mjs — run every `tools/test-*.mjs` at once, and report honestly.
 *
 * ==> THIS EXISTS BECAUSE A SESSION REPORTED A GREEN TEST AS BROKEN. <==
 * 2026-08-24. The loop was the obvious one:
 *
 *     for f in tools/test-*.mjs; do timeout 120 node "$f" || echo "RED: $f"; done
 *
 * `test-genesis.mjs` takes 195 seconds. It was killed at 120 and reported red,
 * and the session then told Aaron its own change had broken it. Nothing was
 * broken. The whole episode was a guessed number.
 *
 * A note in CLAUDE.md saying "genesis is slow" would not have stopped it —
 * the previous note said exactly that about `test-lifecycle.mjs` and the same
 * mistake happened anyway. So the fix is a runner rather than a sentence: the
 * timeout here is generous by default, every suite's DURATION is printed
 * whether it passed or not, and a suite killed by the timeout says so in those
 * words rather than joining the failures.
 *
 * ==> A TIMEOUT KILL AND A TEST FAILURE ARE DIFFERENT FACTS AND ARE PRINTED
 * DIFFERENTLY. <== That is the same distinction §5 makes everywhere else in
 * this app: "the source errored" is not "there is nothing there". A runner
 * that flattens `slow` into `failed` manufactures exactly the wrong belief at
 * the moment somebody is deciding whether their change is safe.
 *
 * ==> IT RUNS THEM IN PARALLEL, WHICH IS WHY THE FULL CHAIN IS AFFORDABLE.
 * <== Sequentially the suite is roughly eleven minutes and most of that is one
 * process waiting while a core sits idle. In parallel the wall clock is close
 * to the slowest single suite. Parallelism is safe here because every suite is
 * zero-dependency, reads fixtures off disk, and writes nothing — none of them
 * shares a port, a file or a database. **A suite that ever needs the static
 * server does not belong in this runner**; those live behind
 * `tools/with-server.sh` and run one at a time.
 *
 * USAGE
 *     node tools/run-suites.mjs                  every suite
 *     node tools/run-suites.mjs --match=season   only ones whose name matches
 *     node tools/run-suites.mjs --jobs=4         narrower parallelism
 *     node tools/run-suites.mjs --timeout=900    seconds per suite
 *
 * Exit code is 0 only when every suite passed. A timeout is a failure for the
 * exit code — it is an unanswered question, and an unanswered question must
 * not read as a pass — but it is reported in its own words above.
 *
 * Zero dependencies. Plain node.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ==> 600 SECONDS, AND THE NUMBER HAS A REASON. <== The slowest suite in the
 * repo is `test-genesis.mjs` at 195s measured on a cloud sandbox under load.
 * The default is three times that, so a suite hitting it is genuinely stuck
 * rather than merely heavy. Anything tighter is a guess, and a guessed timeout
 * is the exact bug this file exists to prevent. */
const DEFAULT_TIMEOUT_S = 600;

/* Parallel width. Capped rather than unbounded because a hundred node
 * processes on a two-core sandbox makes every one of them slower and pushes
 * the honest suites toward a timeout they would never otherwise reach. */
const DEFAULT_JOBS = Math.max(2, Math.min(8, cpus().length));

const args = process.argv.slice(2);
function flag(name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const match = flag('match', '');
const jobs = Number(flag('jobs', DEFAULT_JOBS));
const timeoutMs = Number(flag('timeout', DEFAULT_TIMEOUT_S)) * 1000;

const suites = readdirSync(join(ROOT, 'tools'))
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
  .filter((f) => !match || f.includes(match))
  .sort();

if (!suites.length) {
  console.error(`no suite matches ${JSON.stringify(match)}`);
  process.exit(1);
}

console.log(`running ${suites.length} suites, ${jobs} at a time, `
  + `${timeoutMs / 1000}s ceiling each\n`);

/** @type {{name:string, ms:number, state:'pass'|'fail'|'timeout', out:string}[]} */
const results = [];

function runOne(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join('tools', name)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });

    /* The kill is recorded as its OWN state before the exit handler runs, so
     * the process's exit code — which is just "killed" — cannot overwrite the
     * more informative fact that it ran out of time. */
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      const state = timedOut ? 'timeout' : (code === 0 ? 'pass' : 'fail');
      results.push({ name, ms, state, out });
      const mark = state === 'pass' ? '✓' : state === 'timeout' ? '⏱' : '✗';
      console.log(`${mark} ${String(Math.round(ms / 1000)).padStart(4)}s  ${name}`);
      resolve();
    });
  });
}

/* A plain worker pool. Each worker pulls the next suite off a shared index
 * rather than taking a fixed slice, so one 195-second suite does not leave its
 * whole slice waiting behind it. */
let next = 0;
async function worker() {
  while (next < suites.length) {
    const mine = suites[next++];
    await runOne(mine);
  }
}

await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, worker));

const failed = results.filter((r) => r.state === 'fail');
const timedOut = results.filter((r) => r.state === 'timeout');
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);

console.log('\nslowest:');
for (const r of slowest) {
  console.log(`  ${String(Math.round(r.ms / 1000)).padStart(4)}s  ${r.name}`);
}

/* ==> THE OUTPUT OF A FAILING SUITE IS PRINTED IN FULL. <== A runner that
 * reports only a name sends the reader back to run it again by hand, and the
 * hand-run is where the wrong timeout gets invented. */
for (const r of failed) {
  console.log(`\n----- ${r.name} -----\n${r.out.trimEnd()}`);
}

if (timedOut.length) {
  console.log(`\n${timedOut.length} suite(s) hit the ${timeoutMs / 1000}s ceiling `
    + `and were KILLED. That is not a failing test — it is an unanswered\n`
    + `question. Re-run the suite on its own before believing anything about it:\n`);
  for (const r of timedOut) console.log(`    node tools/${r.name}`);
}

const passed = results.filter((r) => r.state === 'pass').length;
console.log(`\n${passed}/${results.length} passed`
  + (failed.length ? `, ${failed.length} failed` : '')
  + (timedOut.length ? `, ${timedOut.length} timed out` : ''));

process.exit(failed.length || timedOut.length ? 1 : 0);
