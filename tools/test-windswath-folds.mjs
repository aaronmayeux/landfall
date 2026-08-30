#!/usr/bin/env node
/**
 * test-windswath-folds.mjs — the wind swath's fold faults (lib/windswath.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-windswath-folds.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> FAULTS THAT LOOK ALIKE AND ARE NOT. <== Aaron reported one symptom — fins
 * and spurs on the bands, 2026-08-21 — and there were two causes under it. A
 * fourth fault, the SPINE folding on a storm that loops, was found on
 * 2026-08-29 and is asserted at the foot of this file. The first two:
 *
 *   1. THE TIMELINE FOLDED. Every forecast hour behind the storm was still
 *      being spliced in after the current position, so the corridor's spine
 *      doubled back before going on. The old rule dropped tau 0 and nothing
 *      else. Fixing this alone takes Lala from 3 folding bands to 1.
 *   2. THE WALLS CROSSED. Offset a curve inward past its own radius of
 *      curvature and it self-intersects over tens of vertices at honest
 *      spacing — invisible to the despike, which only sees hairlines. Fixing
 *      this alone takes Lala from 3 to 0, but leaves the spine wrong.
 *
 * Both are asserted independently below, and the mutation runs prove each
 * fix's own tests fail when only that fix is removed.
 *
 * ==> ON THIS FIXTURE, FIX 1 ALONE CLEARS EVERY FOLD. THE LOOP CUT IS STILL
 * NEEDED AND HERE IS THE EVIDENCE. <== The repo fixture carries the forecast
 * and current tiers only. On the FULL tiers — the past wind field included,
 * a megabyte that is deliberately not in the repo — fix 1 alone leaves one
 * folding band on Lala and the cut is what clears it (measured 2026-08-22,
 * SPEC-MAP.md §7.12). The cut is therefore exercised here on constructed
 * rings, where its behaviour can be reasoned about exactly, rather than left
 * to a fixture that happens not to need it.
 *
 * THE FIXTURE IS REAL ARCHIVED BYTES. `samples/lala-cp012026/wind-*-038-*` is
 * the 2026-08-21T23:30Z archive run. The past tier is deliberately NOT in the
 * repo — it is a megabyte and the fault reproduces without it, which is itself
 * asserted so nobody re-adds it thinking it was needed.
 *
 * THE CLOCK IS PINNED to the feed's own observation time for that run.
 *
 * WHAT THIS CANNOT PROVE: that the bands READ as continuous blobs. Whether a
 * swath looks like weather is a question for a phone.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { buildFullTrack, __internals } = await import('../lib/windswath.js');
const { WIND_SWEEP } = await import('../config/constants.js');
const { parseNhcValidtime } = await import('../lib/time.js');
const { segCross, firstCrossing, cutLoop, ringArea2 } = await import('../lib/unloop.js');

const S = 'samples/lala-cp012026';
const feats = (f) => JSON.parse(readFileSync(`${S}/${f}`, 'utf8')).features;

/* The feed's own record for Lala in that archive run (advisory 038). */
const AT = '2026-08-21T21:00:00.000Z';
const POS = { lon: -170.4, lat: 28.6 };

/* `_time` is stamped during parsing, not published on the wire, so the fixture
 * gets it through the SAME parser the app uses. */
function forecastPoints() {
  const fs = feats('forecast-points-038-stale.geojson');
  for (const f of fs) {
    f.properties._time = parseNhcValidtime(f.properties.validtime, f.properties.advdate);
  }
  return fs;
}

const NO_CUT = { ...WIND_SWEEP, maxLoopCuts: 0 };

function build({ at = AT, opts = WIND_SWEEP } = {}) {
  return buildFullTrack({
    currentField: feats('wind-current-038.geojson'),
    forecastRadii: feats('wind-swath-038-recurve.geojson'),
    forecastPoints: forecastPoints(),
    currentPos: at ? { ...POS, at } : { ...POS },
  }, opts);
}

/** Bands whose boundary crosses itself. */
const folding = (fs) => fs.filter((f) => firstCrossing(f.geometry.coordinates[0].slice(0, -1)));

/* Quiet the module's own warnings — they are asserted, not read. */
function muted(fn) {
  const w = console.warn;
  const seen = [];
  console.warn = (m) => seen.push(String(m));
  try { return { out: fn(), seen }; } finally { console.warn = w; }
}

/* ---------------------------------------------------------------------------
 * THE FIXTURE
 * ------------------------------------------------------------------------- */
section('the fixture still carries the fault');
{
  const fp = forecastPoints();
  const curAt = Date.parse(AT);
  const behind = fp.filter((f) => f.properties._time <= curAt);
  ok(behind.length === 2,
    `two forecast hours should sit behind the feed's 21:00Z fix, got ${behind.length}`
    + ' — if this changed the fixture has been swapped and reproduces nothing');
  ok(behind.some((f) => f.properties.tau === 12),
    'the hour behind the storm that is NOT tau 0 is the whole point — tau 12 must be one of them');

  /* The old rule dropped tau 0 only, so tau 12 survived and folded the spine. */
  const raw = muted(() => build({ at: null, opts: NO_CUT }));
  ok(folding(raw.out).length === 3,
    `the old tau-0-only rule should leave 3 folding bands, got ${folding(raw.out).length}`);

  /* And it reproduces with no past tier at all — the megabyte stays out. */
  ok(raw.out.length >= 3, 'the fault reproduces from the forecast and current tiers alone');
}

/* ---------------------------------------------------------------------------
 * FAULT 1 — the timeline
 * ------------------------------------------------------------------------- */
section('every forecast hour behind the storm is dropped, not just tau 0');
{
  const withTime = muted(() => build({ opts: NO_CUT }));
  ok(folding(withTime.out).length === 0,
    'dropping every expired hour should clear all three folding bands ON ITS OWN, '
    + `with the loop cut disabled, got ${folding(withTime.out).length}`);

  /* THE FALLBACK MUST NOT MOVE. A source with no readable clock keeps the old
   * behaviour exactly — absence of a time is not evidence an hour has passed. */
  const noClock = muted(() => build({ at: null, opts: NO_CUT }));
  const noClockBad = muted(() => build({ at: 'not a date', opts: NO_CUT }));
  ok(folding(noClock.out).length === folding(noClockBad.out).length,
    'an unparseable observation time must behave exactly like no time at all');

  /* Tau 0 goes whether or not there is a clock, because it is the analysis
   * hour and always sits behind the storm. */
  const sumArea = (fs) => fs.reduce((s, f) => s + Math.abs(ringArea2(f.geometry.coordinates[0])), 0);
  const areas = sumArea(muted(() => build({ opts: NO_CUT })).out);
  const areasOld = sumArea(muted(() => build({ at: null, opts: NO_CUT })).out);
  ok(areas < areasOld,
    'dropping the extra expired hour should shrink the drawn area, not grow it — '
    + 'a corridor that doubles back covers ground twice');
}

/* ---------------------------------------------------------------------------
 * FAULT 2 — the walls
 * ------------------------------------------------------------------------- */
section('a wall that crosses itself has the loop cut out');
{
  /* The primitives, on shapes small enough to reason about by hand. */
  ok(segCross([0, 0], [2, 2], [0, 2], [2, 0]) != null, 'an X must register as a crossing');
  ok(segCross([0, 0], [1, 1], [1, 1], [2, 0]) == null,
    'two segments sharing an endpoint are neighbours, not a crossing');
  ok(segCross([0, 0], [1, 0], [0, 1], [1, 1]) == null, 'parallel segments do not cross');

  /* A figure-eight: a big square with a small loop pinched into one side. */
  const eight = [[0, 0], [10, 0], [10, 10], [0, 10], [1, 5], [3, 4], [3, 6], [1, 5.0001]];
  const hit = firstCrossing(eight);
  ok(hit != null, 'a figure-eight must be found to cross itself');
  const ring = eight.slice();
  cutLoop(ring, hit);
  ok(firstCrossing(ring) == null, 'after the cut the ring must be simple');
  ok(Math.abs(ringArea2(ring)) > Math.abs(ringArea2(eight)) * 0.8,
    'the cut must keep the big square and discard the small loop, not the other way round');

  /* ==> THE LARGER PIECE WINS BY AREA, NOT BY INDEX SPAN. <== Every fold
   * measured on real bytes had the loop as the SHORTER run of indices, so a
   * shorter-run rule would pass those and fail silently the day it did not.
   * Here the artefact loop is the LONGER run. */
  const inverted = [[1, 5], [3, 4], [3, 6], [1, 5.0001], [0, 10], [0, 0], [10, 0], [10, 10]];
  const ring2 = inverted.slice();
  const hit2 = firstCrossing(ring2);
  ok(hit2 != null, 'the inverted figure-eight must also be found to cross');
  cutLoop(ring2, hit2);
  ok(firstCrossing(ring2) == null, 'and it must also come out simple');
  ok(Math.abs(ringArea2(ring2)) > 50,
    'the big square must survive even when it is the longer index run, got area '
    + (Math.abs(ringArea2(ring2)) / 2).toFixed(1));
}

/* ---------------------------------------------------------------------------
 * THE POINT OF ALL OF IT
 * ------------------------------------------------------------------------- */
section('with both fixes, no band crosses itself');
{
  const out = muted(() => build());
  ok(out.out.length > 0, 'bands are still drawn — a fold fix that empties the layer is a §5 bug');
  ok(folding(out.out).length === 0,
    `no band may cross itself, got ${folding(out.out).length}`);
  ok(!out.seen.some((m) => /still crosses itself/.test(m)),
    'and the guard warning must not have fired');

  for (const f of out.out) {
    const r = f.geometry.coordinates[0];
    ok(r.length > 3, `a band must have a real ring, got ${r.length} vertices`);
    ok(r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1],
      'every ring must still be closed after cutting');
    ok(r.every((v) => Number.isFinite(v[0]) && Number.isFinite(v[1])),
      'no band may carry a non-finite coordinate');
  }
}

section('the guard says so rather than spinning');
{
  /* Cuts disabled AND the old tau-0-only timeline, so a crossing survives to
   * be reported. With the timeline fixed there is nothing left to warn about,
   * which is the whole point. */
  const spun = muted(() => build({ at: null, opts: { ...WIND_SWEEP, maxLoopCuts: 0 } }));
  ok(spun.seen.some((m) => /still crosses itself/.test(m)),
    'a ring left crossing must warn — silence on a known-wrong shape is the §5 failure');
  ok(spun.out.length > 0,
    'and it must still draw the band: a slightly wrong band beats a missing one');
}

/* ===========================================================================
 * FAULT 3 — THE SPINE FOLDED, AND THE BANDS STOPPED NESTING
 *
 * ==> A DIFFERENT FAULT FROM THE TWO ABOVE, AND THE MEASUREMENT IS WHAT PROVES
 * IT. <== Faults 1 and 2 are about a WALL going wrong. This one is about the
 * track itself: a corridor traced as two offset walls only describes a swept
 * region while the path does not overlap itself. On a storm that loops, the
 * inner wall swings past the loop's centre and the traced boundary stops
 * enclosing the ground the storm covered — and the WIDER the band the more it
 * loses, which is backwards from what nesting needs.
 *
 * ==> NESTING IS THE ASSERTION BECAUSE IT IS THE ONE THING THAT CANNOT BE A
 * MATTER OF TASTE. <== Anywhere that saw 64 kt necessarily saw 50 and 34. A
 * band shape can be argued about; a 64 kt outline drawn outside the 34 kt one
 * is simply false, whatever it looks like.
 *
 * Jeanne 2004 is the reproduction case and she is already in the repo, added
 * for §57.48. Katrina and Harvey are the controls, and Harvey earns his place
 * twice over — see the floor section below.
 * ======================================================================== */

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { buildSeasonSwath } = await import('../lib/season-windswath.js');
const { pathCrossings, splitIndices } = await import('../lib/unloop.js');

const seasonFile = (basin, year) => {
  const idx = JSON.parse(readFileSync('seasons/index.json', 'utf8'));
  return parseHurdat2(readFileSync(`seasons/data/${idx.basins[basin].seasons[year]}`, 'utf8')).storms;
};
const jeanne = parseHurdat2(
  readFileSync('samples/seasons/storms/al112004.txt', 'utf8')
).storms[0];
const katrina = seasonFile('atlantic', '2005').find((s) => s.id === 'AL122005');
const harvey = seasonFile('atlantic', '2017').find((s) => s.id === 'AL092017');

/** Even-odd point-in-ring. Deliberately written here rather than imported: a
 *  nesting test that shared its containment maths with the builder could pass
 *  on the builder's own mistake (§12). */
function inRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** What share of the inner band's outline falls outside the outer band's, as
 *  a percentage of its vertices. Zero is the only correct answer. */
function outsidePct(features, innerKt, outerKt) {
  const at = (kt) => features.filter((f) => f.properties.radii === kt);
  const inner = at(innerKt);
  const outer = at(outerKt);
  if (!inner.length || !outer.length) return null;
  let total = 0;
  let out = 0;
  for (const g of inner) {
    for (const v of g.geometry.coordinates[0]) {
      total += 1;
      if (!outer.some((o) => inRing(v, o.geometry.coordinates[0]))) out += 1;
    }
  }
  return total ? (100 * out) / total : 0;
}

/* Splitting turned off. This is EXACTLY the shipped behaviour before this
 * pass, so every "before" figure below is the real fault and not a model of
 * it — the mutation run is built into the suite rather than done once by hand
 * and written up. */
const NO_SPLIT = { ...WIND_SWEEP, loopMinWidthNm: Infinity };

section('a looping storm: the bands nest, and did not before');
{
  const before = buildSeasonSwath(jeanne, NO_SPLIT);
  const after = buildSeasonSwath(jeanne);

  /* ==> THE BUG IS ASSERTED TO EXIST FIRST. <== A nesting test that only
   * checked the fixed build would pass just as happily against a builder that
   * had never had the fault, and would therefore not be guarding anything. */
  ok(outsidePct(before, 64, 34) > 20,
    'WITHOUT the spine split, Jeanne\'s 64 kt outline is largely outside her '
    + `34 kt outline (${outsidePct(before, 64, 34).toFixed(1)}%) — the fault this section guards`);
  ok(outsidePct(before, 64, 50) > 20,
    'and outside her 50 kt outline too '
    + `(${outsidePct(before, 64, 50).toFixed(1)}%)`);

  ok(outsidePct(after, 64, 34) === 0,
    'WITH it, not one vertex of her 64 kt outline falls outside her 34 kt band');
  ok(outsidePct(after, 50, 34) === 0,
    'nor one of her 50 kt outline');

  /* ==> THE 64-AGAINST-50 PAIR IS NOT ZERO AND THE NUMBER IS WRITTEN DOWN
   * RATHER THAN THE ASSERTION LOOSENED TO HIDE IT. <== Nine vertices, worst
   * 1.7 nm outside, against bands over 100 nm wide. That is the ring polish's
   * own documented bound (WIND_SWEEP.ringSmoothPasses), not a spine fault. If
   * it ever climbs, this is what says so. */
  ok(outsidePct(after, 64, 50) < 3,
    'and her 64-against-50 residue stays inside the polish\'s own bound '
    + `(${outsidePct(after, 64, 50).toFixed(1)}%, measured 1.9%)`);
}

section('a storm that never loops is not touched');
{
  for (const [name, storm] of [['Katrina 2005', katrina], ['Harvey 2017', harvey]]) {
    const before = buildSeasonSwath(storm, NO_SPLIT);
    const after = buildSeasonSwath(storm);
    ok(before.length === after.length,
      `${name} produces the same number of bands either way — the split must not `
      + 'cut a storm it has nothing to fix');
    for (const [inner, outer] of [[64, 50], [64, 34], [50, 34]]) {
      ok((outsidePct(after, inner, outer) || 0) === 0,
        `${name}: ${inner} kt stays inside ${outer} kt`);
    }
  }
}

section('a crossing is not automatically a loop');
{
  /* ==> HARVEY IS THE CASE, AND HE IS WHY THE FLOOR EXISTS. <== HURDAT2 stores
   * position to 0.1°, about 6 nm. Harvey sat still over Texas and jittered
   * inside his own rounding, manufacturing a crossing 8 nm across. Cutting his
   * corridor there put 2.8% of his 50 kt outline outside his 34 kt — a fault
   * he did not have. §57.49 measured the same 8 nm independently, for the
   * sentence on the storm panel. */
  const idx = JSON.parse(readFileSync('seasons/index.json', 'utf8'));
  void idx;
  const { timelineFor } = await import('../lib/season-windswath.js');
  const { onOneBranch } = await import('../lib/windswath.js');
  const br = onOneBranch(timelineFor(harvey));
  const refLat = br.reduce((s, p) => s + p.lat, 0) / br.length;
  const lonScale = 60 * Math.cos((refLat * Math.PI) / 180);
  const lon0 = br[0].lon;
  const plane = br.map((p) => [(p.lon - lon0) * lonScale, p.lat * 60]);
  const found = pathCrossings(plane);

  ok(found.length > 0,
    'Harvey DOES cross his own track — so a test that only counted crossings '
    + 'would have cut him');
  ok(found.every((c) => c.width < WIND_SWEEP.loopMinWidthNm),
    `and every one of them is under the floor (widest ${Math.max(...found.map((c) => c.width)).toFixed(0)} nm) — `
    + 'which is what refuses him');

  const jbr = onOneBranch(timelineFor(jeanne));
  const jLat = jbr.reduce((s, p) => s + p.lat, 0) / jbr.length;
  const jScale = 60 * Math.cos((jLat * Math.PI) / 180);
  const jPlane = jbr.map((p) => [(p.lon - jbr[0].lon) * jScale, p.lat * 60]);
  const jFound = pathCrossings(jPlane);
  ok(jFound.some((c) => c.width >= WIND_SWEEP.loopMinWidthNm),
    `Jeanne's loop clears it comfortably (${Math.max(...jFound.map((c) => c.width)).toFixed(0)} nm) — `
    + 'the floor separates the two, it does not just refuse everything');
}

section('the fewest breaks that separate every crossing');
{
  /* Interval stabbing, checked on shapes chosen so a lazy rule gets them
   * wrong. Breaking at index k puts segments up to k-1 in one piece and j>=k
   * in the next, so a crossing (i, j) needs a break in [i+1, j]. */
  ok(splitIndices([]).length === 0, 'no crossings, no breaks');
  ok(splitIndices([{ i: 2, j: 9 }]).length === 1, 'one crossing, one break');

  /* Three crossings whose spans all overlap at index 9. A rule that broke at
   * both ends of each would return six. */
  const nested = [{ i: 2, j: 9 }, { i: 3, j: 12 }, { i: 4, j: 14 }];
  ok(splitIndices(nested).length === 1,
    'three overlapping crossings need ONE break, not three and not six');
  const cut = splitIndices(nested)[0];
  ok(nested.every((c) => cut >= c.i + 1 && cut <= c.j),
    'and that break genuinely separates all three');

  /* Disjoint spans cannot share a break. */
  ok(splitIndices([{ i: 1, j: 3 }, { i: 8, j: 11 }]).length === 2,
    'two crossings that share no index need two breaks');

  /* ==> AND NADINE IS THE REAL CASE. <== She crosses her own path five times,
   * four of them real loops. A lazy rule would cut her eight ways; two breaks
   * separate all four. */
  const nadine = seasonFile('atlantic', '2012').find((s) => s.id === 'AL142012');
  const { timelineFor: tf } = await import('../lib/season-windswath.js');
  const { onOneBranch: ob } = await import('../lib/windswath.js');
  const nbr = ob(tf(nadine));
  const nLat = nbr.reduce((s, p) => s + p.lat, 0) / nbr.length;
  const nScale = 60 * Math.cos((nLat * Math.PI) / 180);
  const nPlane = nbr.map((p) => [(p.lon - nbr[0].lon) * nScale, p.lat * 60]);
  const real = pathCrossings(nPlane).filter((c) => c.width >= WIND_SWEEP.loopMinWidthNm);
  ok(real.length === 4 && splitIndices(real).length === 2,
    `Nadine 2012's four real loops are separated by two breaks, not four `
    + `(got ${real.length} loops, ${splitIndices(real).length} breaks)`);
}

section('a path\'s crossings, and what is not one');
{
  /* A figure-eight. One crossing, and the enclosed piece has real width. */
  const eight = [[0, 0], [10, 10], [10, 0], [0, 10]];
  const hits = pathCrossings(eight);
  ok(hits.length === 1, 'a figure-eight crosses itself exactly once');
  ok(hits[0].width > 4, `and encloses something of real width (${hits[0].width.toFixed(1)})`);

  ok(pathCrossings([[0, 0], [10, 0], [20, 0], [30, 0]]).length === 0,
    'a straight line crosses itself nowhere');
  ok(pathCrossings([[0, 0], [10, 0], [0, 0], [10, 0]]).length === 0,
    'and a path folded exactly back along itself encloses no area, so it is '
    + 'not a loop — the same call storm-shape.js makes');
  ok(pathCrossings([[0, 0], [1, 1]]).length === 0, 'too short to look');
}


section('a break never leaves a stub');
{
  /* ==> IDA 2021 IS THE CASE, AND SHE WAS FOUND BY A SUITE THAT WAS NOT
   * LOOKING FOR THIS. <== Her loop break lands on the second-to-last fix of a
   * run, leaving two near-coincident points. Swept, that became a 73-vertex
   * polygon carrying 18 zero-length edges — on the map, a small circle
   * OUTLINED inside the band, covering nothing the neighbouring piece's end
   * cap did not already cover. `test-season-swath.mjs`'s axis-aligned-edge
   * assertion caught it, which is the argument for keeping assertions that
   * look at shape rather than at counts. */
  const ida = seasonFile('atlantic', '2021').find((s) => s.id === 'AL092021');
  const before = buildSeasonSwath(ida, NO_SPLIT);
  const after = buildSeasonSwath(ida);

  const zeroLen = (fs) => {
    let n = 0;
    for (const f of fs) {
      const r = f.geometry.coordinates[0];
      for (let i = 1; i < r.length; i++) {
        if (Math.abs(r[i][0] - r[i - 1][0]) < 1e-12
          && Math.abs(r[i][1] - r[i - 1][1]) < 1e-12) n += 1;
      }
    }
    return n;
  };
  ok(zeroLen(after) === 0 && zeroLen(before) === 0,
    'Ida gains no repeated vertex from being broken');
  ok(after.length === before.length,
    'and gains no band either — a piece too short to be a corridor is not one');

  /* The rule, stated on constructed input so it is not hostage to Ida's
   * particular geometry: a break at the very ends does not happen at all. */
  const twoStub = [
    { x: 0, y: 0, quad: { ne: 60, se: 60, sw: 60, nw: 60 }, brk: false },
    { x: 100, y: 0, quad: { ne: 60, se: 60, sw: 60, nw: 60 }, brk: true },
    { x: 100.2, y: 0, quad: { ne: 60, se: 60, sw: 60, nw: 60 }, brk: false },
  ];
  ok(__internals.breakRun(twoStub, WIND_SWEEP).length === 1,
    'a break that would leave a 0.2 nm stub is refused outright');
  const evenly = [
    { x: 0, y: 0, quad: { ne: 60, se: 60, sw: 60, nw: 60 }, brk: false },
    { x: 100, y: 0, quad: { ne: 60, se: 60, sw: 60, nw: 60 }, brk: true },
    { x: 200, y: 0, quad: { ne: 60, se: 60, sw: 60, nw: 60 }, brk: false },
  ];
  const split = __internals.breakRun(evenly, WIND_SWEEP);
  ok(split.length === 2, 'a break with real track on both sides is taken');
  ok(split[0][split[0].length - 1] === split[1][0],
    'and the two pieces SHARE the point they meet at, so no gap opens between them');
}

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
