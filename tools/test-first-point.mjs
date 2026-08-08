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

import { STORM_GEO } from '../config/tokens.js';
const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { stampFirst } = await import('../map/layers/points-forecast.js');

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
section('The casing is sized off the ring it backs');

/* ==> THE ONE ASSERTION THAT IS ABOUT PIXELS AND NOT ABOUT `_first`. <==
 *
 * The white ring only says "start of forecast" if it reads as white, and in
 * the greyscale light theme it stopped: 1.72:1 over the sea, 1.13:1 over the
 * near-white land. `firstCasingLayer` backs it with a near-black disc.
 *
 * The failure mode this guards is arithmetic, not colour: a casing radius that
 * does not clear the dot's own outer edge draws NOTHING — it is completely
 * hidden under the dot it exists to back, silently, and the ring goes back to
 * being invisible with every test still green. The colours are gated by
 * tools/contrast-check.mjs; the geometry is gated here. */
{
  const dotOuter = STORM_GEO.pointRadius + STORM_GEO.pointStrokeWidthFirst;
  const casing = dotOuter + STORM_GEO.firstCasingWidth;
  ok(casing > dotOuter,
     'the casing clears the first dot\'s outer edge, so some of it is visible');
  ok(STORM_GEO.firstCasingWidth >= 1,
     'the visible casing is at least a pixel wide — below that it is a rumour');
  ok(casing > STORM_GEO.pointRadius + STORM_GEO.pointStrokeWidth,
     'and it clears an ORDINARY dot too, so the marked one is the bigger mark');
}

/* ------------------------------------------------------------------ */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
