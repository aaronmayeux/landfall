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

/** A state object in the shape the store publishes.
 *
 *  ==> THE GENESIS BRANCH DEFAULTS TO `none_matched` WITH NO AREAS, AND THAT
 *      DEFAULT IS ITSELF AN ASSERTION. <== (§45.)
 *
 *  `none_matched` means the watch sources answered and published nothing —
 *  the state the world is in most of the year, and the only one under which
 *  the pre-§45 rungs still mean what they used to. Defaulting it to `loading`
 *  or leaving it off would make every legacy case below return `loading` or
 *  `unavailable` and quietly stop testing what they were written to test. */
const st = (nhc, gdacs, storms = 0, genesis = {}) => ({
  storms: Array.from({ length: storms }, (_, i) => ({ id: `s${i}` })),
  sources: {
    nhc: { status: nhc, fetchedAt: null, error: null, slow: false },
    gdacs: { status: gdacs, fetchedAt: null, error: null, slow: false },
  },
  genesis: { status: 'none_matched', areas: [], ...genesis },
});

/** n watched areas, in the shape lib/genesis.js produces. */
const areas = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i}`, source: 'NHC', prob7day: 40 }));

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
/* ---------------------------------------------------------------------------
 * §45 — A WATCHED AREA IS A THING ON THE GLOBE
 *
 * The rule being pinned here is not new. It already existed for ENDED storms:
 * anything drawn on the globe outranks an all-clear, because a grey dot on
 * screen contradicts the words "all clear". A hatched genesis patch
 * contradicts them the same way.
 *
 * THE MEASUREMENT THAT FORCED IT, 2026-08-09, both fetches minutes apart:
 * `CurrentStorms.json` returned `{"activeStorms":[]}` while the outlook
 * published FIVE areas, one at 80% over seven days. The app would have said
 * "No active storms" at that instant and been technically true and completely
 * wrong.
 * ------------------------------------------------------------------------- */
section('§45 — watched areas and the all-clear');

ok(
  overallStatus(st('ok', 'ok', 0, { status: 'ok', areas: areas(5) })) === 'ok',
  'zero storms and five watched areas is NOT clear — the measured 2026-08-09 case'
);
ok(
  overallStatus(st('ok', 'ok', 0, { status: 'none_matched', areas: [] })) === 'clear',
  'zero storms and nothing being watched IS clear — the all-clear, finally earned'
);
ok(
  overallStatus(st('ok', 'ok', 0, { status: 'unavailable', areas: [] })) === 'unavailable',
  'the outlook being DOWN does not earn an all-clear: we cannot see the whole '
  + 'question, so we do not get to give the reassuring half of it'
);
ok(
  overallStatus(st('ok', 'ok', 0, { status: 'unavailable', areas: [] })) !== 'ok',
  'and an outage must NOT masquerade as something being watched either — '
  + '`ok` here would imply a patch is drawn when none is'
);
ok(
  overallStatus(st('ok', 'ok', 0, { status: 'loading', areas: [] })) === 'loading',
  'the watch list still in flight holds the answer at loading, exactly as a '
  + 'storm feed in flight does'
);
ok(
  overallStatus(st('ok', 'ok', 3, { status: 'ok', areas: areas(5) })) === 'ok',
  'storms present still outrank everything, areas or not'
);

/* THE ORDERING WEIGHTS MUST NEVER REACH THE SCREEN (§45.8). They exist so one
 * list can hold NHC percentages and JTWC words; rendering one would present an
 * invented probability as though JTWC had published it. */
section('§45 — the ordering weights are never rendered');

const viewSrc = fs.readFileSync('ui/view-storms.js', 'utf8');
ok(
  !/orderWeight/.test(viewSrc),
  'ui/view-storms.js never reads GENESIS.orderWeight — it sorts a list the '
  + 'data layer already ordered'
);

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
ok(
  view.includes("if ((state.genesis?.areas?.length ?? 0) > 0) return 'ok';"),
  "ui/view-storms.js overall() carries the §45 rung too — its copy of this "
  + 'ladder is deliberate, so it is deliberately checked'
);
ok(
  view.includes("state.genesis?.status === 'none_matched'") &&
    !/st\.every\(\(x\) => x === 'ok'\)\) return 'clear'/.test(view),
  "and its `clear` requires the watch list to have ANSWERED, not merely "
  + 'not-failed'
);

/* ------------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  ${pass} passed, ${failures.length} failed`
                            : `\n✓ ${pass} assertions passed`);
console.log('  (the rung is right; whether the words read right is glass)');
process.exit(failures.length ? 1 : 0);
