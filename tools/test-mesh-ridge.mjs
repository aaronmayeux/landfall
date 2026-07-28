#!/usr/bin/env node
/**
 * test-mesh-ridge.mjs — who gets a ridge, and how tall a GUESSED bead may be.
 *
 * ZERO DEPENDENCIES, like every other tool here: a guard that only runs on the
 * machine which happens to have a package installed is not a guard (§12).
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated up front:
 *
 *   IT CAN prove the two rules. That a storm nobody is publishing a wind for
 *   contributes its head and nothing else, in BOTH of the states that means
 *   (ended and silent, which are different facts from different places and were
 *   the entire difference between Aaron's phone and his work PC). And that a
 *   derived past bead is held under the strongest wind its own source ever
 *   published, while a MEASURED one is passed through untouched.
 *
 *   IT CANNOT prove the globe looks right. THE STANDING RULE: when a fixture
 *   passes and glass fails, the fixture is wrong.
 *
 * THE NUMBERS ARE NOUL'S REAL ONES. GDACS published her at "HU" with a peak of
 * 85 kt (98 mph, as the storm list renders it). `representativeKt('HU')` is
 * ~109.5 kt — the middle of the whole hurricane range — so before the ceiling
 * every past bead on her track stood a full category above anything GDACS ever
 * said about her, in HURRICANE_UNKNOWN_COLOR pink. That is the ridge Aaron saw
 * on a fresh install, and it is what these assertions are about.
 */

/* THREE is a CDN global in the browser; the ridge builder only needs a
 * normalizable 3-vector, so a two-line stand-in keeps this file dependency
 * free (§12) and exercises the real code path. Set BEFORE the dynamic imports
 * below — a static `import` is hoisted and would run lib/geo.js first. */
globalThis.THREE = {
  Vector3: class {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    normalize() { return this; }
  },
};

const { buildMeshPoints } = await import('../map/storm-mesh.js');
const { DIVE } = await import('../config/constants.js');
const { representativeKt } = await import('../lib/category.js');

let pass = 0;
let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL  ${what}`);
};
const near = (a, b, what, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${what} (got ${a}, want ${b})`);

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const HOUR = 3600e3;

/* A GDACS-shaped past point: no measured wind, severity carried entirely in
 * the source's own intensity letter. `_catCode` is load-bearing — a GDACS
 * hurricane legitimately has a null Saffir-Simpson index (data/lifecycle.js). */
const gdacsPoint = (hoursAgo, code = 'HU') => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [114 + hoursAgo * 0.1, 22] },
  /* FIELD NAMES READ OFF lib/track-point.js, not guessed: the time is `_time`,
   * and a stamped intensity letter needs `_catStamped` beside `_catCode` or
   * `trackPointReading` falls through to the generic colour with no severity
   * at all. Getting either wrong makes a bead silently vanish. */
  properties: { _time: NOW - hoursAgo * HOUR, _catCode: code, _catStamped: true, _catIndex: null },
});

/* The same shape with a MEASURED wind on it, which must win outright. */
const measuredPoint = (hoursAgo, kt) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [114 + hoursAgo * 0.1, 22] },
  properties: {
    _time: NOW - hoursAgo * HOUR, _catCode: 'HU', _catStamped: true, _catIndex: null, _windKt: kt,
  },
});

const bundleOf = (features) => ({
  layers: {
    pastPoints: { status: 'ok', fc: { type: 'FeatureCollection', features } },
    forecastPoints: { status: 'none' },
  },
});

const noul = (extra = {}) => ({
  id: 'gdacs:1102983',
  source: 'gdacs',
  lon: 114,
  lat: 22,
  nature: 'tropical',
  category: null,
  categoryCode: 'HU',
  windKt: null,       // GDACS publishes no current wind — the whole reason for this file
  peakWindKt: 85,     // 98 mph, as the list renders it
  observedAt: NOW - 6 * HOUR,
  ...extra,
});

const build = (storm, features) =>
  buildMeshPoints({
    storms: [storm],
    mode: 'track',
    bundleFor: () => bundleOf(features),
    nowMs: NOW,
  });

console.log('\n--- a live storm still gets its ridge ---');
{
  const pts = build(noul(), [gdacsPoint(24), gdacsPoint(12), gdacsPoint(6)]);
  ok(pts.length === 4, `head plus three beads (got ${pts.length})`);
  ok(pts.filter((p) => p.head).length === 1, 'exactly one head');
  ok(pts[0].head === true, 'the head is entered FIRST — it must win a tie for the node colour');
}

console.log('\n--- a SILENT storm collapses to its head ---');
{
  /* Silent is computed from the clock: still listed, still flagged current, no
   * fresh analysis. This is NOUL on any device where she was not hand-killed,
   * and it is the case that excluding only `ended` would have missed. */
  const silent = noul({ observedAt: NOW - 30 * HOUR });
  const pts = build(silent, [gdacsPoint(48), gdacsPoint(36), gdacsPoint(30)]);
  ok(pts.length === 1, `head only (got ${pts.length})`);
  ok(pts[0].head === true, 'and it is the head');
  near(pts[0].sev, DIVE.sevNoReadingLift, 'head sits at the no-reading lift');
}

console.log('\n--- an ENDED storm collapses to its head ---');
{
  const ended = noul({ ended: { reason: 'declared', by: 'JTWC', at: NOW - 2 * HOUR } });
  const pts = build(ended, [gdacsPoint(24), gdacsPoint(12)]);
  ok(pts.length === 1, `head only (got ${pts.length})`);
  near(pts[0].sev, DIVE.sevNoReadingLift, 'head sits at the no-reading lift');
}

console.log('\n--- the ridge comes BACK when a silent storm updates again ---');
{
  const revived = noul({ observedAt: NOW - 1 * HOUR });
  const pts = build(revived, [gdacsPoint(24), gdacsPoint(12)]);
  ok(pts.length === 3, `head plus two beads (got ${pts.length})`);
}

console.log('\n--- a DERIVED past bead is held at the published peak ---');
{
  const midpoint = representativeKt(null, 'tropical', 'HU');
  ok(midpoint > 100, `the class midpoint really is high (${midpoint} kt)`);
  ok(midpoint > 85, 'and it really does exceed the published peak — this is the bug');

  const live = noul();
  const pts = build(live, [gdacsPoint(24)]);
  const bead = pts.find((p) => !p.head);

  /* Height is sevFromKt, so compare against the ramp rather than reimplementing
   * it: the bead must sit where 85 kt sits, not where ~109.5 kt sits. */
  const sevOf = (kt) => {
    const t = Math.max(0, Math.min(1, (kt - DIVE.sevFloorKt) / (DIVE.sevPeakKt - DIVE.sevFloorKt)));
    return DIVE.sevMinLift + (1 - DIVE.sevMinLift) * Math.pow(t, DIVE.sevCurve);
  };
  near(bead.sev, sevOf(85), 'bead stands at the published peak, not the class midpoint');
  ok(bead.sev < sevOf(midpoint), 'and that is strictly lower than it used to be');
}

console.log('\n--- the ceiling only ever pulls DOWN ---');
{
  /* A source whose published peak is well above the class midpoint must not
   * RAISE the bead to it. min(), never substitution. */
  const strong = noul({ peakWindKt: 150 });
  const pts = build(strong, [gdacsPoint(24)]);
  const bead = pts.find((p) => !p.head);
  const midpoint = representativeKt(null, 'tropical', 'HU');
  const sevOf = (kt) => {
    const t = Math.max(0, Math.min(1, (kt - DIVE.sevFloorKt) / (DIVE.sevPeakKt - DIVE.sevFloorKt)));
    return DIVE.sevMinLift + (1 - DIVE.sevMinLift) * Math.pow(t, DIVE.sevCurve);
  };
  near(bead.sev, sevOf(midpoint), 'bead stays at the class midpoint, not raised to 150 kt');
}

console.log('\n--- a MEASURED wind is never capped ---');
{
  /* The whole point of the JTWC join. A real number outranks every guess and
   * every ceiling, including one above the published peak — because the peak
   * is GDACS's FORECAST peak, not evidence of what the storm did. */
  const live = noul();
  const pts = build(live, [measuredPoint(24, 120)]);
  const bead = pts.find((p) => !p.head);
  const sevOf = (kt) => {
    const t = Math.max(0, Math.min(1, (kt - DIVE.sevFloorKt) / (DIVE.sevPeakKt - DIVE.sevFloorKt)));
    return DIVE.sevMinLift + (1 - DIVE.sevMinLift) * Math.pow(t, DIVE.sevCurve);
  };
  near(bead.sev, sevOf(120), 'measured 120 kt passes through the 85 kt ceiling untouched');
}

console.log('\n--- a weaker class still reads lower than the ceiling ---');
{
  /* The ordering GDACS DOES carry reliably must survive: a leg it labels
   * tropical storm cannot be lifted to the hurricane ceiling. */
  const live = noul();
  const pts = build(live, [gdacsPoint(24, 'TS')]);
  const bead = pts.find((p) => !p.head);
  const hu = build(live, [gdacsPoint(24, 'HU')]).find((p) => !p.head);
  ok(bead.sev < hu.sev, 'a TS bead stands lower than an HU bead on the same storm');
}

console.log('\n--- CURRENT mode is untouched ---');
{
  const silent = noul({ observedAt: NOW - 30 * HOUR });
  const pts = buildMeshPoints({
    storms: [silent],
    mode: 'current',
    bundleFor: () => bundleOf([gdacsPoint(24)]),
    nowMs: NOW,
  });
  ok(pts.length === 1, 'one point per storm, as always');
  ok(pts[0].head === true, 'and it is the head');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
