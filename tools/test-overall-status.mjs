/**
 * test-overall-status.mjs — the four-rung answer the empty state is built on.
 *
 * WHY THIS FILE EXISTS. `overallStatus` picks between "Checking the oceans…"
 * and a red "Storm feeds are not responding", and it shipped for months
 * answering the second one during a perfectly normal startup: the rung read
 * `every(loading)`, the two feeds are fetched IN PARALLEL, and the moment the
 * faster one landed empty while the slower one was still in flight the answer
 * fell through to `unavailable`.
 *
 * A rule that decides whether the app claims an outage is worth four lines of
 * arithmetic in a test. Every combination below is a real startup ordering.
 *
 * The logic is DUPLICATED in ui/view-storms.js `overall()` on purpose — the
 * view must not import the store (§12, one-directional imports). So this file
 * asserts the two copies agree, which is the only thing keeping a deliberate
 * duplication from becoming a drift.
 *
 * Zero dependencies. `node tools/test-overall-status.mjs`.
 */

import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

/* data/store.js pulls in data/lifecycle.js, which persists and which reads
 * localStorage at init. Same stand-in the lifecycle suite uses. */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
/* Nothing here fetches, but the import chain must not be able to try. */
globalThis.fetch = async () => {
  throw new Error('no test in this file may touch the network');
};

const { overallStatus } = await import('../data/store.js');

/** A state object in the shape the store publishes. */
const st = (nhc, gdacs, storms = 0) => ({
  storms: Array.from({ length: storms }, (_, i) => ({ id: `s${i}` })),
  sources: {
    nhc: { status: nhc, fetchedAt: null, error: null, slow: false },
    gdacs: { status: gdacs, fetchedAt: null, error: null, slow: false },
  },
});

/* ---------------------------------------------------------------------------
 * THE BUG THIS FILE WAS WRITTEN FOR
 * ------------------------------------------------------------------------- */
section('a startup with one fast feed and one slow one is LOADING');

ok(
  overallStatus(st('ok', 'loading')) === 'loading',
  'NHC answered empty, GDACS still in flight — not an outage'
);
ok(
  overallStatus(st('loading', 'ok')) === 'loading',
  'and the same the other way round'
);
ok(
  overallStatus(st('unavailable', 'loading')) === 'loading',
  'even with one feed already failed: the other has not spoken, so we are '
  + 'still waiting. It becomes unavailable the moment GDACS resolves.'
);

/* ---------------------------------------------------------------------------
 * THE RUNGS THAT WERE ALREADY RIGHT, PINNED SO THE FIX DID NOT MOVE THEM
 * ------------------------------------------------------------------------- */
section('the other three rungs');

ok(
  overallStatus(st('loading', 'loading')) === 'loading',
  'nothing has resolved: loading'
);
ok(
  overallStatus(st('ok', 'ok')) === 'clear',
  'both feeds clean and zero storms: the only true all-clear'
);
ok(
  overallStatus(st('unavailable', 'ok')) === 'unavailable',
  'a dead feed and an empty ocean is NOT an all-clear (§5)'
);
ok(
  overallStatus(st('unavailable', 'unavailable')) === 'unavailable',
  'both dead: unavailable'
);

section('storms on screen outrank everything');

ok(
  overallStatus(st('ok', 'unavailable', 2)) === 'ok',
  'partial data is shown; the outage is named separately'
);
ok(
  overallStatus(st('ok', 'loading', 1)) === 'ok',
  'a storm from the fast feed shows immediately, not held behind the slow one'
);

/* ---------------------------------------------------------------------------
 * THE DUPLICATE MUST AGREE
 *
 * ui/view-storms.js cannot import the store, so it restates the rule. Reading
 * the file as TEXT rather than importing it is deliberate: the view touches
 * the DOM at module scope and cannot be loaded in node. Crude, and it is the
 * only thing standing between a documented duplication and a silent drift.
 * ------------------------------------------------------------------------- */
section('the view’s copy of the rule matches');

const view = fs.readFileSync('ui/view-storms.js', 'utf8');
ok(
  view.includes("if (st.some((x) => x === 'loading')) return 'loading';"),
  'ui/view-storms.js overall() uses some(loading), not every(loading)'
);
ok(
  !view.includes("st.every((x) => x === 'loading')"),
  'and the old every(loading) rung is gone from it entirely'
);

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  ${pass} passed, ${failures.length} failed`
                            : `\n✓ ${pass} assertions passed`);
console.log('  (the rung is right; whether the words read right is glass)');
process.exit(failures.length ? 1 : 0);
