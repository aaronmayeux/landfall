#!/usr/bin/env node
/**
 * test-season-cut.mjs — the season clock's cut on the globe.
 * SPEC-SEASONS-BUILD.md §57.23, §57.67 slice B, §57.35 fault 3.
 *
 * ZERO DEPENDENCIES, plain `node tools/test-season-cut.mjs`.
 *
 * ==> THE ASSERTION THIS SUITE EXISTS FOR IS SECTION 1, AND IT IS THAT NOTHING
 * CHANGED. <== Slice B adds an argument to two functions the whole archive
 * already depends on, and the promise made in §57.67b is that with no cut the
 * output is byte-identical to what shipped before. A promise like that is
 * either compared as strings or it is a hope: section 1 pushes six real 2005
 * storms with the argument and without it, and compares the two GeoJSON
 * payloads with `JSON.stringify`. Anything at all that moved — a coordinate, a
 * property, an ordering — turns it red.
 *
 * ==> AND SECTION 3 EXISTS BECAUSE OF A MEASUREMENT, NOT A HUNCH. <==
 * `smoothPath` runs a storm's fixes through `dedupe()` before splining, which
 * drops any fix sitting on top of the one before it. Measured across the whole
 * shipped archive on 2026-08-31: **130 of 3,266 storms lose at least one fix
 * that way, up to 9 in one storm.** An index built over the DEDUPED list and
 * read with a raw fix number puts those storms' heads up to nine fixes behind
 * the truth while every other storm on the globe looks perfect — the exact
 * shape of bug that survives a green suite.
 *
 * ==> WHICH IS WHY THERE IS A NEW FIXTURE. NO SAMPLE STORM HAD A DROPPED FIX.
 * <== Measured the same day: all eighteen storms in `samples/seasons/storms/`
 * spline without dedupe touching one. So a suite written against what was
 * already there could not see this bug at all. `al041995.txt` is DEAN 1995, cut
 * out of the shipped 1995 file with nothing edited — a depression that stalled
 * over Texas and reported the same position six times running.
 *
 * ==> EVERY EXPECTATION IS COMPUTED OFF THE REAL FILES. <== `CLAUDE.md`'s first
 * rule. The fixes, the timestamps and the vertex counts all come out of
 * `seasons/data/` and `samples/seasons/storms/`, so a test cannot pass by
 * agreeing with a number somebody remembered.
 *
 * WHAT THIS CANNOT PROVE: whether a growing track READS as a storm moving, or
 * whether the globe holds frame rate while it grows. Both are glass, and slice
 * B deliberately puts nothing on screen for Aaron to judge (§57.67b).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
process.chdir(ROOT);

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);
const section = (n) => console.log(`\n  ${n}`);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { SEASONS, TRACK_LINE } = await import('../config/constants.js');
const { smoothPath, smoothPathIndexed } = await import('../lib/trackline.js');
const { clockFrameAt, clockSpan, stormStateAt } = await import('../lib/season-clock.js');
const {
  cutStateFor, cutHidesStorm, cutDrawnFixes, cutVertex, cutCurve,
} = await import('../map/layers/season-cut.js');
const {
  ensureSeasonTracks, setSeasonTracks, clearSeasonTracks,
} = await import('../map/layers/season-tracks.js');
const {
  ensureSeasonPoints, setSeasonPoints, clearSeasonPoints, setSeasonPointFocus,
} = await import('../map/layers/season-points.js');

/** The same recording stub the sibling suites use. It does not validate
 *  expressions on purpose — see `test-season-tracks.mjs` for why. */
function fakeMap(sourceId) {
  const sources = new Map();
  const layers = [];
  return {
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.find((l) => l.id === id) || null,
    addSource(id, def) { sources.set(id, { data: def.data, setData(d) { this.data = d; } }); },
    addLayer(def, beforeId) { layers.push({ ...def, beforeId }); },
    setPaintProperty() {},
    on() {},
    data: () => sources.get(sourceId)?.data,
  };
}

const entry = (storm) => ({ storm, facts: stormFacts(storm) });
const one = (f) => parseHurdat2(readFileSync(`samples/seasons/storms/${f}.txt`, 'utf8')).storms[0];

const seasonOf = (basin, year) => {
  const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  return parseHurdat2(readFileSync(join(ROOT, 'seasons', 'data', index.basins[basin].seasons[String(year)]), 'utf8')).storms;
};

const AL2005 = seasonOf('atlantic', 2005);
const KATRINA = AL2005.find((s) => s.name === 'KATRINA');
/* ==> KEONI 1993 IS HERE FOR ONE REASON: dedupe() DROPS FIVE OF HIS FIXES AND
 * THEY ARE NEAR THE START. <== Section 3 explains why that placement is what
 * makes him the right fixture and a stalled storm the wrong one. Cut out of
 * the shipped 1993 East Pacific file with nothing edited. */
const KEONI = one('cp011993');
const AL1851 = seasonOf('atlantic', 1851);  /* holds single-observation entries */

/** The fixes a layer holds for a storm, which is what `drawnFixes` indexes. */
const trackFixes = (s) => (s.points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lonU));
const dotFixes = (s) => (s.points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));

/** A cut built the way slice C will build it: one frame, keyed by id. */
const cutAt = (entries, t) => new Map(clockFrameAt(entries, t).storms.map((s) => [s.id, s.state]));

/* =========================================================================
 * 1. ==> NO CUT MEANS NOTHING MOVED. THE ONE ASSERTION SLICE B PROMISES. <==
 * ====================================================================== */
section('1. ==> WITH NO CUT THE PAYLOAD IS BYTE-IDENTICAL <==');

{
  const six = AL2005.slice(0, 6).map(entry);

  const a = fakeMap('season-tracks');
  ensureSeasonTracks(a);
  setSeasonTracks(a, six);
  const withoutArg = JSON.stringify(a.data());
  clearSeasonTracks(a);

  setSeasonTracks(a, six, null);
  const withNullCut = JSON.stringify(a.data());
  clearSeasonTracks(a);

  ok('the tracks push the same bytes whether the cut argument is absent or null',
    withoutArg === withNullCut);
  ok('and that payload is not trivially empty', withoutArg.length > 1000);

  const p = fakeMap('season-points');
  ensureSeasonPoints(p);
  setSeasonPoints(p, six);
  const dotsNoArg = JSON.stringify(p.data());
  clearSeasonPoints(p);
  setSeasonPoints(p, six, null);
  const dotsNullCut = JSON.stringify(p.data());
  clearSeasonPoints(p);

  ok('the dots push the same bytes either way', dotsNoArg === dotsNullCut);
}

{
  /* ==> AND THE SAME AGAIN WITH A CUT THAT COVERS THE WHOLE SEASON. <== A cut
   * taken at the season's LAST moment leaves every storm `ended`, which by
   * §57.67c rule 2 keeps its whole track. If that is not byte-identical to no
   * cut at all, the cut is quietly rewriting geometry it should be leaving
   * alone. */
  const six = AL2005.slice(0, 6).map(entry);
  const span = clockSpan(six);

  const a = fakeMap('season-tracks');
  ensureSeasonTracks(a);
  setSeasonTracks(a, six);
  const whole = JSON.stringify(a.data());
  clearSeasonTracks(a);
  setSeasonTracks(a, six, cutAt(six, span.to));
  const ended = JSON.stringify(a.data());
  clearSeasonTracks(a);

  ok('a cut at the end of the season redraws every track whole, to the byte',
    whole === ended);
}

/* =========================================================================
 * 2. THE CURVE IS CUT, NEVER REBUILT
 * ====================================================================== */
section('2. The cut slices a cached curve — §57.35 fault 3');

{
  const raw = trackFixes(KATRINA).map((p) => [p.lonU, p.lat]);
  const { curve, index } = smoothPathIndexed(raw, SEASONS.trackMaxVertices);

  eq('the index has one entry per recorded fix', index.length, raw.length);
  eq('the first fix is the first vertex', index[0], 0);
  eq('the last fix is the last vertex', index[index.length - 1], curve.length - 1);

  ok('the index never runs backwards',
    index.every((v, i) => i === 0 || v >= index[i - 1]));

  /* ==> EVERY FIX SITS ON THE VERTEX THE INDEX NAMES. <== The curve passes
   * through its knots, so this is the property that makes the whole scheme
   * work — and it is checked against the storm's own coordinates rather than
   * against a remembered vertex number. */
  let worst = 0;
  for (let i = 0; i < raw.length; i++) {
    const v = curve[index[i]];
    worst = Math.max(worst, Math.hypot(v[0] - raw[i][0], v[1] - raw[i][1]));
  }
  ok(`every fix lands on its own vertex (worst miss ${worst.toExponential(2)}°)`, worst < 1e-9);

  /* Halfway along a leg is halfway along that leg's vertices. */
  const mid = cutVertex(index, { phase: 'running', drawnFixes: 5, legFraction: 0.5 });
  eq('half a leg is half the vertices between its two fixes',
    mid, index[4] + (index[5] - index[4]) / 2);

  const cut = cutCurve(curve, index, { phase: 'running', drawnFixes: 5, legFraction: 0.5 });
  ok('the cut curve is shorter than the whole one', cut.length < curve.length);
  eq('and it begins at the same place the whole one does', cut[0], curve[0]);
  ok('every vertex before the head is the SAME OBJECT the memo holds — nothing '
    + 'was re-splined',
    cut.slice(0, cut.length - 1).every((c, i) => c === curve[i]));

  /* ==> THE FINAL VERTEX IS INTERPOLATED, NOT ROUNDED TO, AND THE LEG IS FOUND
   * RATHER THAN PICKED. <== A rounded cut would make the tip jump several
   * vertices at a time on a long leg, which is the thing worth guarding.
   *
   * ==> THE FIRST VERSION OF THIS ASSERTION WAS A TAUTOLOGY AND THE MUTATION
   * RUN IS WHAT FOUND IT. <== It drove fix 5 at half a leg, that leg happened
   * to span an EVEN number of vertices, so the head landed exactly ON a vertex,
   * the interpolated answer and the rounded answer were the same point, and
   * deleting the interpolation left the suite green. §12's failure exactly, and
   * the same shape as slice A's status assertion (§57.67d). So the leg is now
   * SCANNED FOR: the first one whose vertex span is odd, which is the only kind
   * where half a leg cannot land on a vertex. A revision to the file may move
   * which leg that is; it cannot turn this back into a comparison of a value
   * with itself. */
  let offVertexFix = -1;
  for (let i = 0; i + 1 < index.length; i++) {
    if ((index[i + 1] - index[i]) % 2 === 1) { offVertexFix = i; break; }
  }
  ok('Katrina has a leg whose half-way point is not on a vertex', offVertexFix >= 0);

  const state = { phase: 'running', drawnFixes: offVertexFix + 1, legFraction: 0.5 };
  const v = cutVertex(index, state);
  ok(`and the head genuinely sits between two vertices there (${v})`, v !== Math.floor(v));

  const tip = cutCurve(curve, index, state).at(-1);
  const whole = Math.floor(v);
  const f = v - whole;
  eq('the tip is lerped between the two vertices the head sits between', tip, [
    curve[whole][0] + (curve[whole + 1][0] - curve[whole][0]) * f,
    curve[whole][1] + (curve[whole + 1][1] - curve[whole][1]) * f,
  ]);
  ok('which is NOT simply the vertex behind it — a rounded cut would be',
    JSON.stringify(tip) !== JSON.stringify(curve[whole]));

  eq('an ended storm keeps its whole curve — §57.67c rule 2',
    cutCurve(curve, index, { phase: 'ended', drawnFixes: raw.length, legFraction: 0 }),
    curve);
  eq('an unborn storm draws nothing at all — §57.67c rule 1',
    cutCurve(curve, index, { phase: 'unborn', drawnFixes: 0, legFraction: 0 }), null);
  eq('and neither does one with no usable fix',
    cutCurve(curve, index, { phase: 'absent', drawnFixes: 0, legFraction: 0 }), null);
  eq('no state at all means the whole curve',
    cutCurve(curve, index, null), curve);

  eq('a head that has not cleared two vertices yet is no line, not a one-point '
    + 'line — MapLibre rejects that and a stub is what the reverted build drew',
    cutCurve(curve, index, { phase: 'running', drawnFixes: 1, legFraction: 0 }), null);
}

/* =========================================================================
 * 3. ==> THE DEDUPE TRAP, AND THE FIXTURE THAT EXISTS TO CATCH IT <==
 * ====================================================================== */
section('3. ==> DEDUPE DROPS FIXES AND THE INDEX MUST NOT <==');

{
  const raw = trackFixes(KEONI).map((p) => [p.lonU, p.lat]);
  const { curve, index } = smoothPathIndexed(raw, SEASONS.trackMaxVertices);

  /* Recount the drop off the real file rather than typing a number, and note
   * WHERE the drops are — that is the whole reason this storm is the fixture
   * and not one of the others. */
  const eps2 = TRACK_LINE.joinEpsDeg * TRACK_LINE.joinEpsDeg;
  const dropAt = [];
  let last = raw[0];
  for (let i = 1; i < raw.length; i++) {
    const dx = raw[i][0] - last[0];
    const dy = raw[i][1] - last[1];
    if (dx * dx + dy * dy > eps2) last = raw[i]; else dropAt.push(i);
  }
  const dropped = dropAt.length;

  ok(`KEONI 1993 really does lose fixes to dedupe (${dropped} of ${raw.length}, at ${dropAt.join(',')})`,
    dropped > 0);

  /* ==> AND THEY ARE NEAR THE START, WITH MOST OF THE TRACK BEHIND THEM. THAT
   * IS THE POINT OF THIS FIXTURE. <== The first storm tried here was DEAN 1995,
   * who stalled over Texas and reported the same position six times running —
   * and every one of her drops was in her TAIL, where a wrong index is covered
   * by the forward fill and the last fix still lands on the last vertex. **The
   * naive version survived the whole suite.** A drop in the MIDDLE shifts every
   * fix after it, which is where the bug actually lives. */
  ok(`and they are mid-track — ${raw.length - 1 - dropAt[dropAt.length - 1]} fixes come after the last one`,
    dropAt[dropAt.length - 1] < raw.length - 1);

  eq('==> THE INDEX HAS ONE ENTRY PER RECORDED FIX. <== Built over the deduped '
    + 'list instead it would be short by exactly the number above',
    index.length, raw.length);

  eq('his last fix maps to his last vertex', index[index.length - 1], curve.length - 1);

  const shared = index.filter((v, i) => i > 0 && v === index[i - 1]).length;
  eq('every dropped fix shares the vertex of the one before it, because that '
    + 'is where the storm actually was', shared, dropped);

  /* ==> THE CONSEQUENCE, IN THE SHAPE A READER WOULD REPORT IT. <== Not the
   * index arithmetic a third time: every one of his fixes must sit ON the
   * vertex the index names it. A short index slides them along the curve, and
   * the further past the drops you look the further out they are. */
  let worst = 0;
  let worstFix = -1;
  for (let i = 0; i < raw.length; i++) {
    const v = curve[index[i]];
    const d = v ? Math.hypot(v[0] - raw[i][0], v[1] - raw[i][1]) : Infinity;
    if (d > worst) { worst = d; worstFix = i; }
  }
  ok(`every one of KEONI's ${raw.length} fixes lands on its own vertex `
    + `(worst is fix ${worstFix} at ${worst.toExponential(2)}°)`, worst < 1e-9);

  /* And the same thing said as a picture: his last moment draws his whole
   * track, dedupe or no dedupe. */
  const e = [entry(KEONI)];
  const span = clockSpan(e);
  const map = fakeMap('season-tracks');
  ensureSeasonTracks(map);
  setSeasonTracks(map, e);
  const wholeTrack = JSON.stringify(map.data());
  clearSeasonTracks(map);
  setSeasonTracks(map, e, cutAt(e, span.to));
  ok('at the last moment of his life KEONI draws his whole track',
    JSON.stringify(map.data()) === wholeTrack);
  clearSeasonTracks(map);
}

/* =========================================================================
 * 4. THE GLOBE FILLS UP AND STAYS FULL
 * ====================================================================== */
section('4. A season accumulates — §57.23');

{
  const six = AL2005.slice(0, 6).map(entry);
  const span = clockSpan(six);
  const map = fakeMap('season-tracks');
  ensureSeasonTracks(map);

  const drawnAt = (t) => {
    setSeasonTracks(map, six, cutAt(six, t));
    return map.data().features.length;
  };

  /* ==> BEFORE THE FIRST STORM THE GLOBE IS GENUINELY EMPTY. <== The reverted
   * build's empty world was partly the opposite fault — a stub for every storm
   * that had not happened — and this is the assertion that would have caught
   * it. */
  eq('one hour before the season starts, nothing is drawn at all',
    drawnAt(span.from - 3_600_000), 0);

  const counts = [];
  for (let k = 0; k <= 8; k++) counts.push(drawnAt(span.from + (span.spanMs * k) / 8));

  ok(`the count never goes down as the clock runs — ${counts.join(' → ')}`,
    counts.every((n, i) => i === 0 || n >= counts[i - 1]));
  eq('and by the end every one of the six is on the globe',
    counts[counts.length - 1], 6);

  /* ==> A LINE GETS LONGER, IT DOES NOT MOVE. <== The trail persisting is the
   * feature; a track that slid along would be a storm being animated rather
   * than a season being drawn. */
  const lenAt = (t) => {
    setSeasonTracks(map, [entry(KATRINA)], cutAt([entry(KATRINA)], t));
    const f = map.data().features[0];
    return f ? f.geometry.coordinates.length : 0;
  };
  const kSpan = clockSpan([entry(KATRINA)]);
  const lens = [];
  for (let k = 1; k <= 8; k++) lens.push(lenAt(kSpan.from + (kSpan.spanMs * k) / 8));
  ok(`Katrina's line only ever grows — ${lens.join(' → ')}`,
    lens.every((n, i) => i === 0 || n >= lens[i - 1]));

  setSeasonTracks(map, [entry(KATRINA)], cutAt([entry(KATRINA)], kSpan.from + kSpan.spanMs / 2));
  const half = map.data().features[0].geometry.coordinates;
  setSeasonTracks(map, [entry(KATRINA)], cutAt([entry(KATRINA)], kSpan.to));
  const full = map.data().features[0].geometry.coordinates;
  eq('and the half-drawn track starts exactly where the finished one does',
    half[0], full[0]);
  clearSeasonTracks(map);
}

/* =========================================================================
 * 5. THE DOTS AGREE WITH THE LINE
 * ====================================================================== */
section('5. The dots stop where the line stops');

{
  const e = [entry(KATRINA)];
  const span = clockSpan(e);
  const map = fakeMap('season-points');
  ensureSeasonPoints(map);
  setSeasonPoints(map, e);
  setSeasonPointFocus(map, KATRINA.id);

  const fixCount = () => map.data().features.filter((f) => f.properties.kind === 'fix').length;

  setSeasonPoints(map, e, cutAt(e, span.to));
  eq('at the end every recorded position has a dot',
    fixCount(), dotFixes(KATRINA).length);

  const mid = span.from + span.spanMs / 2;
  setSeasonPoints(map, e, cutAt(e, mid));
  const midDots = fixCount();
  ok(`halfway through she has some dots but not all (${midDots} of ${dotFixes(KATRINA).length})`,
    midDots > 0 && midDots < dotFixes(KATRINA).length);

  eq('and the number of dots is exactly the number of fixes the clock says have '
    + 'happened — the dots and the line read one answer',
    midDots, stormStateAt(KATRINA, mid).drawnFixes);

  setSeasonPoints(map, e, cutAt(e, span.from - 3_600_000));
  eq('before she exists she has no dots', fixCount(), 0);

  /* ==> OPENING A STORM MID-PLAYBACK MUST NOT REVEAL ITS FUTURE. <== `setFocus`
   * rebuilds the features from the remembered set, and this is the assertion
   * that the remembered CUT is rebuilt with them. */
  setSeasonPoints(map, e, cutAt(e, mid));
  setSeasonPointFocus(map, null);
  setSeasonPointFocus(map, KATRINA.id);
  eq('tapping a storm while the clock is running does not hand it its whole '
    + 'future', fixCount(), midDots);

  clearSeasonPoints(map);
}

{
  /* ==> A ONE-RECORD STORM IS THE CASE WHERE THE CLOCK OVERRULES THIS FILE'S §5
   * INSTINCT, SO IT GETS ITS OWN ASSERTIONS. <== A standing dot is such a
   * storm's ENTIRE presence on the globe, drawn whether or not it is selected,
   * and `season-points.js` argues at length that withholding it is the silence
   * this project cares most about. The clock withholds it anyway until the
   * storm has happened — and then never again.
   *
   * FOUND BY RULE, NOT BY NAME. 1851 is read out of the real archive and the
   * single-observation entries are picked out of it, so a revision to the file
   * cannot turn this into a test of nothing. */
  const single = AL1851.find((s) => dotFixes(s).length === 1);
  ok('1851 really does contain a single-observation entry', Boolean(single));

  const e = [entry(single)];
  const span = clockSpan(e);
  const map = fakeMap('season-points');
  ensureSeasonPoints(map);

  setSeasonPoints(map, e, cutAt(e, span.to));
  const dot = map.data().features.length;
  eq('once it has happened it is one dot on the globe', dot, 1);
  eq('and it is the standing kind, not a per-fix one',
    map.data().features[0].properties.kind, 'one');

  setSeasonPoints(map, e, cutAt(e, span.from - 3_600_000));
  eq('but before it happened it draws nothing at all — not even the standing '
    + 'dot, because a storm that has not happened is not being silenced, it is '
    + 'being reported accurately', map.data().features.length, 0);

  setSeasonPoints(map, e, cutAt(e, span.to));
  eq('and it comes back when the clock reaches it again', map.data().features.length, 1);
  clearSeasonPoints(map);
}

/* =========================================================================
 * 6. THE FAILURE PATHS
 * ====================================================================== */
section('6. What a missing or broken cut does');

{
  eq('no cut at all means no state', cutStateFor(null, 'AL122005'), null);
  eq('a cut that is not a Map is treated as no cut', cutStateFor({}, 'AL122005'), null);
  eq('a storm with no id has no state', cutStateFor(new Map(), null), null);

  /* ==> A STORM MISSING FROM THE CUT DRAWS WHOLE RATHER THAN VANISHING. <== §5.
   * A visibly odd globe points at the cause; a storm that quietly disappears is
   * the reverted build's empty world. */
  const e = [entry(KATRINA)];
  const map = fakeMap('season-tracks');
  ensureSeasonTracks(map);
  setSeasonTracks(map, e);
  const whole = JSON.stringify(map.data());
  clearSeasonTracks(map);
  setSeasonTracks(map, e, new Map());
  eq('a storm the cut says nothing about draws in full, not not-at-all',
    JSON.stringify(map.data()), whole);
  clearSeasonTracks(map);

  eq('a drawn count past the end of the list is clamped to it',
    cutDrawnFixes({ phase: 'running', drawnFixes: 9999 }, 40), 40);
  eq('and a negative one is clamped to zero',
    cutDrawnFixes({ phase: 'running', drawnFixes: -5 }, 40), 0);
  eq('a missing count is not a whole track',
    cutDrawnFixes({ phase: 'running' }, 40), 0);
  eq('but no state at all is', cutDrawnFixes(null, 40), 40);

  ok('unborn hides a storm', cutHidesStorm({ phase: 'unborn' }));
  ok('absent hides a storm', cutHidesStorm({ phase: 'absent' }));
  ok('running does not', !cutHidesStorm({ phase: 'running' }));
  ok('ended does not', !cutHidesStorm({ phase: 'ended' }));
  ok('and no state does not', !cutHidesStorm(null));
}

/* =========================================================================
 * 7. THE THREE FIX LISTS STILL AGREE — the clamp's own premise
 * ====================================================================== */
section('7. ==> THE PREMISE THE CLAMP RESTS ON, RE-MEASURED <==');

{
  /* `drawnFixes` is counted over the clock's filter and read as a position in
   * two others. §57.67e records that they never differ across the whole
   * archive; this re-derives it over one full season so a change to any of the
   * three filters is caught by a suite rather than on a phone. */
  let checked = 0;
  let differ = 0;
  for (const s of AL2005) {
    checked++;
    const clock = (s.points || []).filter((p) => (
      Number.isFinite(p?.lat) && Number.isFinite(p?.lonU) && Number.isFinite(p?.time)
    ));
    if (clock.length !== trackFixes(s).length) differ++;
    if (clock.length !== dotFixes(s).length) differ++;
  }
  eq(`the clock, the track and the dot hold the same fixes across all ${checked} `
    + 'storms of 2005', differ, 0);
}

/* =========================================================================
 * 8. ==> THE TWO SEAMS. THE FAULT THAT HAS ALREADY SHIPPED TWICE. <==
 * ====================================================================== */
section('8. ==> THE DATELINE AND THE PRIME MERIDIAN <==');

{
  /* ==> A LINE DRAWN THROUGH WRAPPED LONGITUDES TRAVELS THE LONG WAY ROUND THE
   * PLANET. <== It made Lala's wind swath a green ring around the globe
   * (`SPEC-MAP.md` §7.12 fault 3) and it is the fault `season-tracks.js` draws
   * `lonU` to avoid. **The cut is a new place for it to come back**, because it
   * interpolates between two vertices — and interpolating across a ±180 jump
   * puts the tip of the trail on the far side of the world.
   *
   * ==> IT DOES NOT COME BACK, AND THE REASON IS STRUCTURAL RATHER THAN
   * LUCKY. <== Everything the cut touches is already in `lonU` space: the memo
   * holds a curve built from `lonU`, the index points into that curve, and the
   * lerp is between two ADJACENT vertices of it. There is no wrapped value
   * anywhere on the path. This section is what stops that quietly ceasing to be
   * true.
   *
   * Both seams are driven on real storms rather than on a fixture, because the
   * archive contains both and a made-up track proves nothing about the record. */

  const seamCrossers = [
    ['the dateline', KEONI],
    ['the prime meridian', one('al041932')],
  ];

  for (const [seam, storm] of seamCrossers) {
    const raw = trackFixes(storm);

    /* Prove the storm actually crosses the thing it is here for, off its own
     * published longitudes — otherwise a revision to the file could leave this
     * section testing an ordinary mid-ocean track. */
    let jumps = 0;
    let flips = 0;
    for (let i = 1; i < raw.length; i++) {
      if (Math.abs(raw[i].lon - raw[i - 1].lon) > 180) jumps++;
      if ((raw[i].lon > 0) !== (raw[i - 1].lon > 0)) flips++;
    }
    ok(`${storm.id} really does cross ${seam} (${jumps} wrap${jumps === 1 ? '' : 's'}, `
      + `${flips} hemisphere change${flips === 1 ? '' : 's'})`, jumps + flips > 0);

    const coords = raw.map((p) => [p.lonU, p.lat]);
    const { curve, index } = smoothPathIndexed(coords, SEASONS.trackMaxVertices);

    /* The baseline: the biggest longitude step the WHOLE curve takes. The cut
     * must not beat it, and comparing against the curve's own worst step rather
     * than against a typed threshold is what makes this a real assertion. */
    let wholeWorst = 0;
    for (let i = 1; i < curve.length; i++) {
      wholeWorst = Math.max(wholeWorst, Math.abs(curve[i][0] - curve[i - 1][0]));
    }

    const e = [entry(storm)];
    const span = clockSpan(e);
    let cutWorst = 0;
    let cuts = 0;
    let tipOutsideItsLeg = 0;

    for (let k = 0; k <= 40; k++) {
      const out = cutCurve(curve, index, cutStateFor(cutAt(e, span.from + (span.spanMs * k) / 40), storm.id));
      if (!out) continue;
      cuts++;
      for (let i = 1; i < out.length; i++) {
        cutWorst = Math.max(cutWorst, Math.abs(out[i][0] - out[i - 1][0]));
      }
      /* The interpolated tip must sit BETWEEN the two vertices it was lerped
       * from. Across a wrapped seam it would land outside them, which is
       * exactly the far-side-of-the-world failure in miniature. */
      const n = out.length - 1;
      if (out[n] !== curve[n] && n > 0) {
        const lo = Math.min(curve[n - 1][0], curve[n][0]);
        const hi = Math.max(curve[n - 1][0], curve[n][0]);
        if (out[n][0] < lo - 1e-9 || out[n][0] > hi + 1e-9) tipOutsideItsLeg++;
      }
    }

    ok(`${cuts} cuts taken across ${storm.id}`, cuts > 10);
    eq(`and not one tip landed outside the leg it was lerped from at ${seam}`,
      tipOutsideItsLeg, 0);
    ok(`==> NO CUT OF ${storm.id} TAKES A BIGGER LONGITUDE STEP THAN THE WHOLE `
      + `CURVE DOES (${cutWorst.toFixed(4)}° vs ${wholeWorst.toFixed(4)}°). <== A `
      + `wrap would show up here as a step near 360`,
      cutWorst <= wholeWorst + 1e-9);
    ok(`which is nowhere near a wrap (${cutWorst.toFixed(2)}° against 180)`,
      cutWorst < 90);
  }
}

{
  /* ==> AND THE HALF-DRAWN TRACK MUST STAY ON THE SAME SIDE OF THE SEAM AS THE
   * FINISHED ONE. <== Said as a picture rather than as arithmetic: KEONI runs
   * from 166°E to 144°W, so his `lonU` passes -180. A cut taken after he
   * crosses has to be a prefix of the finished line, sharing its first vertex
   * and never re-entering from the other edge of the map. */
  const e = [entry(KEONI)];
  const span = clockSpan(e);
  const map = fakeMap('season-tracks');
  ensureSeasonTracks(map);

  setSeasonTracks(map, e, cutAt(e, span.to));
  const full = map.data().features[0].geometry.coordinates;
  const crossed = full.findIndex((c) => c[0] < -180);
  ok(`KEONI's drawn line really does run past -180 (vertex ${crossed} of ${full.length})`,
    crossed > 0);

  setSeasonTracks(map, e, cutAt(e, span.from + span.spanMs * 0.8));
  const late = map.data().features[0].geometry.coordinates;
  ok('a cut taken after he crosses is past the seam too', late.at(-1)[0] < -180);
  eq('and it still starts exactly where the finished line starts', late[0], full[0]);
  ok('every vertex of it but the tip is the finished line, in order',
    late.slice(0, -1).every((c, i) => c[0] === full[i][0] && c[1] === full[i][1]));
  clearSeasonTracks(map);
}


/* ========================================================================= */
console.log(`\n${fails.length ? '✗' : '✓'} ${pass} assertions pass — the season clock's cut on the globe`);
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
