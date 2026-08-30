#!/usr/bin/env node
/**
 * test-first-point.mjs — the white ring on each storm's earliest forecast
 * point (map/layers/points-forecast.js, `stampFirst`).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-first-point.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * WHY THIS SUITE EXISTS. The mark's whole job is telling the reader which end
 * of a dot chain the storm is travelling away from, and the one way it can
 * fail while still LOOKING right is by marking the wrong dot — a mistake that
 * on glass is a plausible white ring in a plausible place, indistinguishable
 * from a correct one unless you already know the answer. That is exactly the
 * failure mode this file's own label-spoke bug had: it grouped every storm
 * into one bucket, drew confidently, and survived several sessions.
 *
 * WHAT THIS CANNOT PROVE: that the ring READS as direction on a phone, or
 * that white is the right ink against a Cat 1 fill. Those are glass questions.
 */

import path from 'node:path';

import { DARK, LIGHT } from '../config/tokens.js';
const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { bornAtByStorm, stampFirst } = await import('../map/layers/points-forecast.js');

/** A forecast point as NHC publishes one, reduced to the fields that matter
 *  here. `basin` + `stormnum` is the stable pair stormKey() prefers. */
const pt = (basin, stormnum, tau, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { basin, stormnum, tau, _first: false, ...extra },
});

/** Which features came back marked, by their tau. */
const marked = (fs) => fs.filter((f) => f.properties._first).map((f) => f.properties.tau);

/* ------------------------------------------------------------------ */
section('One storm');

{
  const fs = [pt('AL', 2, 0), pt('AL', 2, 12), pt('AL', 2, 24)];
  stampFirst(fs);
  ok(marked(fs).length === 1, 'exactly one point marked');
  ok(fs[0].properties._first === true, 'tau 0 is the marked one');
}

{
  /* UPSTREAM ORDER IS NOT TRUSTED. NHC delivers in order today; the ring must
   * not depend on that continuing to be true. */
  const fs = [pt('AL', 2, 24), pt('AL', 2, 0), pt('AL', 2, 12)];
  stampFirst(fs);
  ok(marked(fs).length === 1 && marked(fs)[0] === 0,
    'lowest tau wins even when the list arrives shuffled');
}

/* ------------------------------------------------------------------ */
section('Several storms at once — the ambient case');

{
  /* THE BUG THIS SUITE IS REALLY FOR. The ambient source carries every live
   * storm in ONE FeatureCollection, so a per-collection "first" would mark
   * one track and leave the rest bare. */
  const fs = [
    pt('AL', 2, 0), pt('AL', 2, 12),
    pt('EP', 6, 0), pt('EP', 6, 12), pt('EP', 6, 24),
    pt('WP', 12, 6), pt('WP', 12, 18),
  ];
  stampFirst(fs);
  ok(marked(fs).length === 3, 'three storms get three rings');
  ok(fs[0].properties._first && fs[2].properties._first && fs[5].properties._first,
    'each ring is on its own storm\'s earliest point');
}

{
  /* Same basin, different storms. `basin` alone would merge them. */
  const fs = [pt('AL', 2, 12), pt('AL', 3, 0)];
  stampFirst(fs);
  ok(marked(fs).length === 2, 'two storms in one basin are two storms');
}

/* ------------------------------------------------------------------ */
section('Sources with no forecast hour — GDACS');

{
  /* GDACS points carry no `tau`, so arrival order is the live path for that
   * source, not a defensive branch nothing exercises. */
  const fs = [
    pt('', '', undefined, { _stormKey: 'gdacs-1001' }),
    pt('', '', undefined, { _stormKey: 'gdacs-1001' }),
  ];
  stampFirst(fs);
  ok(marked(fs).length === 1 && fs[0].properties._first === true,
    'with no tau anywhere, the first to arrive is marked');
}

{
  /* A real hour beats a missing one regardless of where it sits. */
  const fs = [
    pt('AL', 2, undefined),
    pt('AL', 2, 36),
  ];
  stampFirst(fs);
  ok(fs[1].properties._first === true, 'a finite tau beats a missing one');
}

/* ------------------------------------------------------------------ */
section('Unattributable points get no ring');

{
  /* A mark saying "the storm starts here" is a claim. A point we cannot tie
   * to a storm cannot support it — same rule as its label. */
  const fs = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { tau: 0, _first: false } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] },
      properties: { tau: 12, _first: false } },
  ];
  stampFirst(fs);
  ok(marked(fs).length === 0, 'no storm key, no ring');
}

{
  /* An orphan must not steal the ring from a real storm sharing the list. */
  const fs = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { tau: 0, _first: false } },
    pt('AL', 2, 6),
    pt('AL', 2, 18),
  ];
  stampFirst(fs);
  ok(marked(fs).length === 1 && fs[1].properties._first === true,
    'the real storm still gets its ring alongside an orphan');
}

/* ------------------------------------------------------------------ */
section('Degenerate input');

{
  const fs = [];
  stampFirst(fs);
  ok(true, 'an empty list does not throw');
}

{
  const fs = [pt('AL', 2, 0)];
  stampFirst(fs);
  ok(fs[0].properties._first === true, 'a lone point is its own first');
}

/* ------------------------------------------------------------------ */
section('The two ring inks are theme-independent, because one file bakes them');

/* `map/layers/points-forecast.js` writes these into the layer from `palette()`
 * instead of referencing global state, and it is only allowed to do that while
 * both palettes agree. The reason it has to: the property is data-driven
 * (`['get','_first']`), MapLibre evaluates data-driven paint in the WORKER, and
 * the worker has no global state — a `gs()` there renders black in both themes
 * without warning. See tools/lib-state-scan.mjs.
 *
 * So if anyone ever makes these differ by theme, they get told HERE that the
 * ring cannot simply start reading global state again. */
{
  ok(DARK.geo.pointStrokeFirst === LIGHT.geo.pointStrokeFirst,
     'pointStrokeFirst is the same in both themes — points-forecast.js bakes it, ' +
     'and cannot switch to gs() because the property is data-driven');
  ok(DARK.geo.pointStroke === LIGHT.geo.pointStroke,
     'pointStroke is the same in both themes, for the same reason');
}

/* ------------------------------------------------------------------ */
section('Genesis, per storm — the same trap the ring fell into');

/* ==> THIS IS THE RING BUG'S TWIN, AND IT IS WHY THE TEST LIVES IN THIS FILE.
 * <== §57.7g. The ambient source carries EVERY live storm's points in one
 * FeatureCollection. `stampFirst` once read `features[0]` and marked one dot
 * across the whole set; `bornAtByStorm` would make the identical mistake by
 * taking the earliest cyclone fix in the collection and applying it to all of
 * them — so a young storm's pre-genesis disturbance would be graded against an
 * older storm's birthday and come out post-tropical, full size, lettered.
 *
 * On glass that is a plausible grey dot in a plausible place. Indistinguishable
 * from a correct one unless you already know the answer. Exactly the failure
 * this file exists for.
 *
 * `dtg` is NHC's past-point time, a NUMBER shaped YYYYMMDDHH. Real values:
 * Lowell's first `TS` is 2026082718 and she carries an `LO` at 2026082618,
 * measured off the archive branch 2026-08-30. */
const born = (basin, stormnum, stormtype, dtg) =>
  pt(basin, stormnum, null, { stormtype, dtg });

{
  /* AL 2 formed on the 25th. EP 11 formed on the 27th and has a disturbance
   * on the 26th — AFTER AL 2's genesis and BEFORE its own. A collection-wide
   * genesis would call that `DB` a post-tropical remnant. */
  const fs = [
    born('AL', 2, 'TS', 2026082500),
    born('AL', 2, 'TS', 2026082512),
    born('EP', 11, 'DB', 2026082600),
    born('EP', 11, 'TS', 2026082700),
  ];
  const m = bornAtByStorm(fs);
  ok(m.get('AL2') === Date.UTC(2026, 7, 25, 0),
     'AL 2 is born at its OWN first cyclone fix');
  ok(m.get('EP11') === Date.UTC(2026, 7, 27, 0),
     'EP 11 is born at ITS own first cyclone fix, two days later — not at AL 2\'s');
  ok(m.get('EP11') > Date.UTC(2026, 7, 26, 0),
     'so EP 11\'s disturbance falls BEFORE its genesis, which is what makes it small and blank');
}

{
  /* A storm that never became a cyclone at all — every fix a wave. Null, not
   * zero: `natureAt` treats a non-finite genesis as "never a storm", and a 0
   * would make every fix read as after it. */
  const fs = [born('AL', 5, 'WV', 2026082500), born('AL', 5, 'DB', 2026082512)];
  ok(bornAtByStorm(fs).get('AL5') === null,
     'a system that never became a cyclone has NO genesis — null, never 0');
}

{
  /* THE EARLIEST, NOT THE LATEST. §57.7c: a storm that goes extratropical and
   * re-intensifies has two cyclone runs, and anchoring on the last one would
   * make its own middle read as pre-genesis. Fed out of order on purpose. */
  const fs = [
    born('AL', 9, 'HU', 2026082900),
    born('AL', 9, 'TS', 2026082600),
    born('AL', 9, 'EX', 2026082712),
  ];
  ok(bornAtByStorm(fs).get('AL9') === Date.UTC(2026, 7, 26, 0),
     'genesis is the EARLIEST cyclone fix, whatever order the features arrive in');
}

{
  /* An unattributable point gets no genesis, the same way it gets no ring.
   * It must not join another storm's group and must not crash the grouping. */
  const orphan = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { stormtype: 'LO', dtg: 2026082600 } };
  const fs = [born('AL', 2, 'TS', 2026082500), orphan];
  const m = bornAtByStorm(fs);
  ok(m.size === 1 && m.has('AL2'),
     'a point we cannot tie to a storm forms no group and joins no other one');
}

/* ==> MUTATIONS, RUN: computing one genesis across the whole collection
 * (`bornAtOf(features)` for every key) fails the EP 11 assertion; taking the
 * LAST cyclone fix instead of the first fails the re-intensification one;
 * returning 0 instead of null fails the never-a-cyclone one. */

/* ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
