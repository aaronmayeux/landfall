#!/usr/bin/env node
/**
 * test-windswath-folds.mjs — the wind swath's two fold faults
 * (lib/windswath.js).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-windswath-folds.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * ==> TWO FAULTS, PROVEN SEPARATE. <== Aaron reported one symptom — fins and
 * spurs on the bands, 2026-08-21 — and there were two causes under it:
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

const { buildFullTrack } = await import('../lib/windswath.js');
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

/* ------------------------------------------------------------------------- */
console.log(`\n  ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`    FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
