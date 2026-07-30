/**
 * test-volcano-field.mjs — the Phase E selection ladder, against the SHIPPED
 * catalog rather than a fixture.
 *
 * ==> TWO THINGS ARE WORTH LOCKING HERE AND THE REST IS NOT. <==
 *
 * 1. THE TIER STILL SELECTS 128. `e19 >= 10` is a claim about a specific file,
 *    and the moment the catalog is refetched or the field renamed it becomes a
 *    claim about nothing. Recomputed from the real bytes, not asserted against
 *    a copied number.
 *
 * 2. A DEAD RELAY NEVER READS AS A CALM PLANET. This is SPEC.md §5 and it is
 *    the reason this layer has two status channels instead of one. A regression
 *    here is silent on screen — 128 volcanoes draw, nothing looks broken, and
 *    the app is quietly reporting calm about a world it cannot see.
 *
 * Deliberately NOT tested: colours, sizes, shader behaviour, anything about how
 * a mark looks. Those are glass questions and a fixture that passes them would
 * be worse than nothing.
 *
 *   node tools/test-volcano-field.mjs
 */

import { readFileSync } from 'node:fs';
import { loadVolcanoField } from '../proto/volcano-field.js';
import { VOLCANO } from '../config/constants.js';

const CATALOG = JSON.parse(readFileSync('assets/hazards/volcanoes-holocene.geojson', 'utf8'));
const M = VOLCANO.marks;
const S = VOLCANO.state;

let passed = 0;
const failures = [];
function ok(what, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${what}${detail ? ' — ' + detail : ''}`);
}
function group(name) {
  console.log('\n  ' + name);
}

/** A fetch that answers the catalog for real and the relay however you say. */
function fetcher(liveAnswer) {
  return (url) => {
    if (String(url).endsWith('.geojson')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CATALOG) });
    }
    if (liveAnswer instanceof Error) return Promise.reject(liveAnswer);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(liveAnswer) });
  };
}

/** A relay payload with all three channels healthy. */
function payload(volcanoes, states = {}) {
  return {
    fetchedAt: new Date().toISOString(),
    sources: {
      ash: { state: states.ash || S.ok },
      weekly: { state: states.weekly || S.ok },
      alerts: { state: states.alerts || S.ok },
    },
    volcanoes,
  };
}

/* --------------------------------------------------------------------- */
group('the quiet tier is recomputed from the shipped catalog');

const tierFromFile = CATALOG.features.filter(
  (f) => Number((f.properties || {})[M.tierField] || 0) >= M.tierMin
).length;

const dark = await loadVolcanoField({ fetchImpl: fetcher(new Error('Failed to fetch')) });

ok('the tier is exactly 128 volcanoes', tierFromFile === 128, 'file says ' + tierFromFile);
ok(
  'a dark relay draws the tier and nothing else',
  dark.counts.total === tierFromFile && dark.counts.quiet === tierFromFile,
  JSON.stringify(dark.counts)
);
ok('the catalog itself still holds 1,196', dark.counts.catalog === 1196, String(dark.counts.catalog));

/* --------------------------------------------------------------------- */
group('a dead relay is never worded, or counted, as a calm planet');

ok('live state is unavailable, not clear', dark.live.state === S.unavailable, dark.live.state);
ok('and the reason survives to the caller', typeof dark.live.error === 'string' && dark.live.error.length > 0);
ok('erupting is zero because it is UNKNOWN, not because it is empty', dark.counts.erupting === 0);
ok(
  'the catalog channel is independently healthy',
  dark.catalog.state === S.ok,
  'a live outage must not mark the catalog broken'
);

const partial = await loadVolcanoField({
  fetchImpl: fetcher(payload([], { ash: S.degraded })),
});
ok(
  'one degraded channel degrades the whole live read',
  partial.live.state === S.degraded,
  partial.live.state
);
ok(
  'three clear channels are clear, which is a normal quiet day',
  (await loadVolcanoField({
    fetchImpl: fetcher(payload([], { ash: S.clear, weekly: S.clear, alerts: S.clear })),
  })).live.state === S.clear
);

/* --------------------------------------------------------------------- */
group('the erupting set is a union and never an intersection');

/** Two real volcanoes chosen because they sit on OPPOSITE sides of the tier.
 *  Picked from the file at runtime so this cannot rot into a name lookup. */
const props = CATALOG.features.map((f) => f.properties);
const inTier = props.find((p) => Number(p[M.tierField] || 0) >= M.tierMin);
const outOfTier = props.find((p) => Number(p[M.tierField] || 0) < M.tierMin && p.elev >= 0);

const union = await loadVolcanoField({
  fetchImpl: fetcher(
    payload([
      { n: outOfTier.n, live: { report: { erupting: true } } },
      { n: inTier.n, live: { report: { erupting: true } } },
    ])
  ),
});
ok(
  'a volcano outside the tier still draws when it is erupting',
  union.marks.some((m) => m.n === outOfTier.n && m.erupting),
  outOfTier.name + ' has ' + (outOfTier[M.tierField] || 0) + ' eruptions since 1900'
);
ok('the tier grows by exactly the outsider', union.counts.total === tierFromFile + 1, String(union.counts.total));
ok('and both read as erupting', union.counts.erupting === 2, String(union.counts.erupting));

/* --------------------------------------------------------------------- */
group('what counts as erupting, one test per feed');

async function eruptingCount(liveBag) {
  const f = await loadVolcanoField({
    fetchImpl: fetcher(payload([{ n: inTier.n, live: liveBag }])),
  });
  return f.counts.erupting;
}

ok('the weekly report saying so is enough', (await eruptingCount({ report: { erupting: true } })) === 1);
ok(
  'an ash advisory alone is enough — an ash cloud IS an eruption',
  (await eruptingCount({ ash: { dtg: '202607301200' } })) === 1
);
ok('aviation RED is enough', (await eruptingCount({ alert: { colour: 'RED' } })) === 1);
ok(
  'aviation ORANGE is enough, deliberately',
  (await eruptingCount({ alert: { colour: 'ORANGE' } })) === 1,
  'over-inclusive on purpose — see VOLCANO.marks.alertColoursErupting'
);
ok('aviation GREEN is not', (await eruptingCount({ alert: { colour: 'GREEN' } })) === 0);
ok(
  'and New Unrest is not — the relay decides that, not us',
  (await eruptingCount({ report: { erupting: false } })) === 0
);

/* --------------------------------------------------------------------- */
group('an erupting volcano we cannot place is counted, never binned');

const orphan = await loadVolcanoField({
  fetchImpl: fetcher(payload([{ n: 999999, live: { report: { erupting: true, weeklyName: 'Pavlof' } } }])),
});
ok('it does not silently vanish', orphan.live.unplaceable.length === 1);
ok('and it carries a name a person can read', orphan.live.unplaceable[0].name === 'Pavlof');
ok('while not inflating the drawn count', orphan.counts.total === tierFromFile);

/* --------------------------------------------------------------------- */
group('submarine volcanoes are flagged, because a cone would be a lie');

ok(
  'the catalog still holds 110 below sea level',
  props.filter((p) => Number(p.elev) < 0).length === 110
);
ok(
  'and the flag rides each mark',
  dark.marks.every((m) => typeof m.submarine === 'boolean') &&
    dark.counts.submarine === dark.marks.filter((m) => m.submarine).length
);

/* --------------------------------------------------------------------- */
group('erupting marks draw last so they land on top');

ok(
  'no quiet mark follows an erupting one',
  union.marks.every((m, i) => i === 0 || !(union.marks[i - 1].erupting && !m.erupting))
);

/* --------------------------------------------------------------------- */
group('a dead catalog is a hard failure and says so');

const noCat = await loadVolcanoField({ fetchImpl: () => Promise.reject(new Error('boom')) });
ok('nothing is drawn', noCat.marks.length === 0);
ok('the state is unavailable', noCat.catalog.state === S.unavailable);
ok('and the reason is carried', noCat.catalog.error === 'boom');

/* --------------------------------------------------------------------- */
console.log('');
for (const f of failures) console.log('  ✗ ' + f);
console.log(`  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
