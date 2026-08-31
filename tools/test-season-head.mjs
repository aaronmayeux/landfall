#!/usr/bin/env node
/**
 * test-season-head.mjs — the season clock's moving head. §57.67 slice E.
 *
 * ==> THE ONE THING THIS SUITE EXISTS TO CATCH IS A HEAD THAT IS NOT ON ITS OWN
 * TRACK. <== §57.67e measured the trap and left the instruction: the clock
 * answers a lon/lat interpolated STRAIGHT between two fixes, the drawn curve
 * BENDS between them, and the two agree at every recorded fix and nowhere else.
 * A head placed at the clock's own point therefore looks perfect at every fix
 * and floats off its track in between — worst on a recurve, which is where
 * anybody watching Katrina is looking.
 *
 * The second thing is the zoom floor. `SPEC-MAP.md` §9.13 deleted MapLibre's
 * copy of the spiral because two engines drew one mark; this puts a MapLibre
 * spiral back on the map, and the only thing keeping that honest is that it
 * starts above the zoom the 3D mesh's own sprite has finished fading out at.
 *
 * The map is a stub that records what was pushed and what images it was handed.
 * It does NOT validate expressions — that is how `tools/test-surge.mjs` stayed
 * green over a feature that never once ran. What is asserted here is the DATA
 * and the layer definition; whether MapLibre paints it is glass.
 *
 * Zero dependencies, plain node.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const fails = [];
const ok = (what, cond) => { cond ? pass++ : fails.push(what); };
const eq = (what, got, want) => ok(
  `${what}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`,
  JSON.stringify(got) === JSON.stringify(want)
);
const section = (t) => console.log(`\n  ${t}\n`);

const { parseHurdat2 } = await import('../lib/hurdat.js');
const { stormFacts } = await import('../lib/season-facts.js');
const { SEASONS } = await import('../config/constants.js');
const { DIVE } = await import('../config/constants.js');
const { SIZE } = await import('../config/tokens.js');
const { categoryColor } = await import('../lib/category.js');
const { clockSpan, clockFrameAt, toStormMs } = await import('../lib/season-clock.js');
const { ensureSeasonTracks, setSeasonTracks, clearSeasonTracks } =
  await import('../map/layers/season-tracks.js');
const {
  ensureSeasonHead, setSeasonHead, clearSeasonHead, setSeasonHeadFocus, __internals,
} = await import('../map/layers/season-head.js');

/** A map that remembers, including its sprite atlas.
 *
 *  ==> `hasImage` ANSWERS OFF THE SAME STORE `addImage` WRITES TO, WHICH IS THE
 *  ONLY PART OF THIS STUB THAT HAD TO BE REAL. <== The layer's whole image path
 *  is "ask, then add if missing", and a stub whose `hasImage` always said no
 *  would let a double-add through without ever failing. */
function fakeMap() {
  const sources = new Map();
  const layers = [];
  const paint = new Map();
  const imgs = new Map();
  const adds = [];
  return {
    added: layers,
    images: imgs,
    adds,
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.find((l) => l.id === id) || null,
    addSource(id, def) {
      sources.set(id, { def, data: def.data, setData(d) { this.data = d; } });
    },
    addLayer(def, beforeId) { layers.push({ ...def, beforeId }); },
    setPaintProperty(layerId, prop, value) { paint.set(`${layerId}.${prop}`, value); },
    paintOf: (layerId, prop) => paint.get(`${layerId}.${prop}`),
    hasImage: (name) => imgs.has(name),
    /* ==> ADDS ARE COUNTED, NOT JUST STORED, AND THAT IS A TEST FAULT MUTATION
     * FOUND. <== The first version only kept the images in a `Map` keyed on the
     * name, so re-adding the same mark sixty times looked identical to adding it
     * once — the assertion below read "how many marks exist" while claiming to
     * read "how much work was done". A texture upload per push on the frame the
     * reader is watching is exactly what it is supposed to catch. */
    addImage(name, data, opts) { imgs.set(name, { data, opts }); adds.push(name); },
    data: () => sources.get('season-head')?.data,
    layer: (id) => layers.find((l) => l.id === id),
  };
}

/* ==> A CANVAS STAND-IN, BECAUSE THE MARK IS AN IMAGE AND NODE HAS NO CANVAS.
 * <== `map/glyph.js` draws the spiral with `Path2D` and a 2D context, and
 * `season-head.js` deliberately answers "no mark" when there is no DOM — which
 * is the right behaviour in the app (a missing canvas must cost the mark and
 * nothing else, the fault `map/layers/genesis.js` records taking the whole layer
 * engine down) and useless in a suite that wants to see the features.
 *
 * ==> IT RECORDS NOTHING ABOUT THE ARTWORK, AND THAT IS STATED RATHER THAN
 * IMPLIED. <== Every drawing call is a no-op. Nothing here can tell a correct
 * spiral from a blank square — the artwork belongs to the 3D engine, which has
 * drawn it since July, and to glass. What this stand-in buys is the ability to
 * assert WHICH image a feature names and WHAT the layer was handed, which is
 * where this slice's faults would live. */
const NOOP = () => {};
globalThis.Path2D = globalThis.Path2D || class { addPath() {} };
globalThis.document = globalThis.document || {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      save: NOOP, restore: NOOP, translate: NOOP, scale: NOOP,
      stroke: NOOP, fill: NOOP, clearRect: NOOP,
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(4) }),
    }),
  }),
};

const entry = (storm) => ({ storm, facts: stormFacts(storm) });

const seasonOf = (basin, year) => {
  const index = JSON.parse(readFileSync(join(ROOT, 'seasons', 'index.json'), 'utf8'));
  const file = index.basins[basin].seasons[String(year)];
  return parseHurdat2(readFileSync(join(ROOT, 'seasons', 'data', file), 'utf8')).storms;
};

const cutAt = (entries, t) =>
  new Map(clockFrameAt(entries, t).storms.map((s) => [s.id, s.state]));

const AL2005 = seasonOf('atlantic', 2005);
const KATRINA = AL2005.find((s) => s.name === 'KATRINA');

/* =========================================================================
 * 1. ATTACHING
 * ====================================================================== */
section('1. The layer');

{
  const map = fakeMap();
  ensureSeasonHead(map, 'storm-dot-planet');

  eq('one layer is added', map.added.length, 1);
  eq('and it draws beneath the storm dots, which puts it above every other '
    + 'archive layer', map.added[0].beforeId, 'storm-dot-planet');
  eq('it starts empty rather than undefined', map.data().features, []);

  /* ==> THE ZOOM FLOOR IS THE MESH'S OWN HANDOFF, AND IT IS READ BACK OUT OF
   * THE DIVE BAND RATHER THAN TYPED. <== `SPEC-MAP.md` §9.13: one engine draws
   * the spiral. Below this zoom the 3D mesh is still stamping every archive
   * storm's mark on its BIRTHPLACE, so a head down there is two spirals per
   * storm meaning two different things. Deleting the floor is invisible on a
   * desktop and obvious on a phone held at the planet band. */
  const floor = DIVE.zSpace + (DIVE.zHandoff - DIVE.zSpace) * DIVE.fade.nodes[1];
  eq('the head starts exactly where the 3D sprite finishes fading out',
    map.added[0].minzoom, floor);
  ok(`which is z${floor} and is above the space floor, not at it`,
    floor > DIVE.zSpace && floor < DIVE.zHandoff);

  eq('the mark is named per feature, so one layer serves every category',
    map.added[0].layout['icon-image'], ['get', 'icon']);
  eq('and so is its rotation', map.added[0].layout['icon-rotate'], ['get', 'rot']);

  /* ==> VIEWPORT, NOT MAP. <== `map` alignment turns the mark with the compass,
   * so a two-finger twist would spin every head on the globe — which is exactly
   * the claim the rotation is NOT making. */
  eq('the mark turns with the storm, never with the compass',
    map.added[0].layout['icon-rotation-alignment'], 'viewport');

  /* A name may be dropped to collision; a storm may not (§9.13, §5). */
  ok('a head is never dropped to make room for another one',
    map.added[0].layout['icon-allow-overlap'] === true
    && map.added[0].layout['icon-ignore-placement'] === true);

  ensureSeasonHead(map, 'storm-dot-planet');
  eq('==> ATTACHING TWICE ADDS NOTHING. <== The archive is entered and left '
    + 'freely and the source outlives all of it', map.added.length, 1);
}

/* =========================================================================
 * 2. WHO HAS A HEAD
 * ====================================================================== */
section('2. Only a running storm has a head');

{
  const e = [entry(KATRINA)];
  const span = clockSpan(e);
  const map = fakeMap();
  ensureSeasonHead(map);

  const headsAt = (t) => {
    const cut = cutAt(e, t);
    setSeasonHead(map, e, cut);
    return map.data().features;
  };

  eq('an hour before she exists, there is no mark at all',
    headsAt(span.from - 3_600_000).length, 0);
  eq('while she is running, there is exactly one',
    headsAt(span.from + span.spanMs / 2).length, 1);

  /* ==> AN ENDED STORM KEEPS ITS TRACK AND LOSES ITS HEAD. §57.67c rule 2. <==
   * The trail persisting is the feature; a mark standing on the final fix says
   * the storm is still there, which is a claim about a storm that is over. */
  eq('and after her last fix the mark is gone, though the trail is not',
    headsAt(span.to).length, 0);

  /* ==> NO CUT IS NO CLOCK, AND NO CLOCK IS NO HEAD. <== The archive without
   * the clock is a set of finished tracks with no current moment for a mark to
   * stand at. This is the assertion that catches a head left on the globe after
   * the reader presses ✕. */
  setSeasonHead(map, e, null);
  eq('with the clock down, nothing is drawn', map.data().features.length, 0);

  clearSeasonHead(map);
}

/* =========================================================================
 * 3. ==> WHERE THE MARK STANDS <==
 * ====================================================================== */
section('3. ==> The head rides the drawn curve, not the straight line <==');

{
  const e = [entry(KATRINA)];
  const span = clockSpan(e);

  const tracks = fakeMap();
  ensureSeasonTracks(tracks);
  const map = fakeMap();
  ensureSeasonHead(map);

  /* ==> THE MOMENT IS FOUND BY SCANNING, NOT PICKED. <== At a moment where the
   * curve happens to pass through the clock's own straight-line answer, the two
   * are the same point and an assertion written there compares a value with
   * itself — the fault §57.67d, §57.67f and §57.67i each record catching, and
   * the first draft of the sibling suite made it again on this exact rule. */
  let at = span.from;
  let off = 0;
  for (let i = 0; i <= 200; i++) {
    const t = span.from + (span.spanMs * i) / 200;
    const st = clockFrameAt(e, t).storms[0].state;
    if (st.phase !== 'running') continue;
    const tips = setSeasonTracks(tracks, e, new Map([[KATRINA.id, st]]));
    const tip = tips.get(KATRINA.id);
    if (!tip) continue;
    const d = Math.hypot(tip[0] - st.lon, tip[1] - st.lat);
    if (d > off) { off = d; at = t; }
  }

  const cut = cutAt(e, at);
  const tips = setSeasonTracks(tracks, e, cut);
  setSeasonHead(map, e, cut, tips);
  const head = map.data().features[0];

  eq('the mark stands on the last vertex of the drawn trail',
    head.geometry.coordinates, tips.get(KATRINA.id));

  const state = cut.get(KATRINA.id);
  ok(`==> AND THAT IS ${(off * 111).toFixed(1)} KM FROM THE POINT THE CLOCK ITSELF `
    + 'ANSWERS, AT THE WORST OF 200 MOMENTS IN HER LIFE. <== Handing the head '
    + '`state.lon`/`state.lat` instead puts it off its own track by that much '
    + 'on a recurve, and dead on at every fix',
    off > 0.01
    && Math.hypot(head.geometry.coordinates[0] - state.lon,
      head.geometry.coordinates[1] - state.lat) === off);

  /* ==> WITH NO TRAIL TO STAND ON IT FALLS BACK TO THE RECORD. <== A storm one
   * step past its first fix has fewer than two vertices, so `cutCurve` answers
   * nothing and there is no tip. The record's own position is the only answer
   * there is, and it beats no mark at all. */
  setSeasonHead(map, e, cut, new Map());
  const fallback = map.data().features[0];
  eq('with no tip in hand the mark stands where the clock says',
    fallback.geometry.coordinates, [state.lon, state.lat]);

  clearSeasonTracks(tracks);
  clearSeasonHead(map);
}

/* =========================================================================
 * 4. ==> THE SEAM <==
 * ====================================================================== */
section('4. ==> A head at the dateline stays on the map <==');

{
  /* KEONI 1993 runs 166°E to 144°W, so her `lonU` — the continuous longitude
   * the trail is drawn in — passes -180 and keeps going. A POINT has no
   * neighbours to be continuous with, so the mark wraps back inside ±180 the
   * way the record itself writes it. */
  const KEONI = parseHurdat2(
    readFileSync(join(ROOT, 'samples', 'seasons', 'storms', 'cp011993.txt'), 'utf8')
  ).storms[0];
  ok('KEONI 1993 is the fixture, cut out of the shipped East Pacific file',
    KEONI?.id === 'CP011993');

  const e = [entry(KEONI)];
  const span = clockSpan(e);
  const tracks = fakeMap();
  ensureSeasonTracks(tracks);
  const map = fakeMap();
  ensureSeasonHead(map);

  let past = 0;
  let wrapped = 0;
  for (let i = 0; i <= 60; i++) {
    const t = span.from + (span.spanMs * i) / 60;
    const cut = cutAt(e, t);
    const tips = setSeasonTracks(tracks, e, cut);
    setSeasonHead(map, e, cut, tips);
    const f = map.data().features[0];
    if (!f) continue;
    const tip = tips.get(KEONI.id);
    if (tip && tip[0] < -180) past++;
    if (f.geometry.coordinates[0] < -180 || f.geometry.coordinates[0] > 180) wrapped++;
  }

  ok(`her trail really does run past -180 (${past} of 61 moments), so this is `
    + 'not a test of a case that never happens', past > 0);
  eq('==> AND NOT ONE OF HER HEADS IS OUTSIDE ±180 <==', wrapped, 0);

  /* Said as arithmetic too, on the values that would break it. A single
   * `-360` is the fix that holds until a storm goes round twice. */
  eq('a longitude two turns out still comes back inside the map',
    __internals.wrapLon(180 + 720 + 30), -150);
  eq('and the same the other way', __internals.wrapLon(-180 - 720 - 30), 150);

  clearSeasonTracks(tracks);
  clearSeasonHead(map);
}

/* =========================================================================
 * 5. ==> THE COLOUR AND THE SPIN <==
 * ====================================================================== */
section('5. ==> Graded at the moment, turning the right way <==');

{
  const e = [entry(KATRINA)];
  const span = clockSpan(e);
  const map = fakeMap();
  ensureSeasonHead(map);

  const colors = new Set();
  const rots = [];
  let graded = 0;
  let samples = 0;
  for (let i = 0; i <= 60; i++) {
    const t = span.from + (span.spanMs * i) / 60;
    const cut = cutAt(e, t);
    setSeasonHead(map, e, cut);
    const f = map.data().features[0];
    if (!f) continue;
    samples++;
    const st = cut.get(KATRINA.id);
    const want = categoryColor(st.category, st.nature, null);
    if (f.properties.icon === __internals.imageName(want, 1)) graded++;
    colors.add(f.properties.icon);
    rots.push(f.properties.rot);
  }

  eq('every mark wears the grade of the moment it is drawn at', graded, samples);
  ok(`and Katrina wears ${colors.size} different ones across her life, so this `
    + 'is not one hue asserted sixty times', colors.size > 3);

  /* ==> IT TURNS, AND IT TURNS THE WAY A NORTHERN CYCLONE TURNS. <== Aaron's
   * call 4, 2026-08-31. `icon-rotate` is degrees CLOCKWISE, and a northern
   * storm goes counter-clockwise, so the angle runs DOWN as time runs forward —
   * wrapped into 0–360, which is what the modulo in `spinDegAt` is for. */
  ok('the mark is at a different angle at every step',
    rots.every((r, i) => i === 0 || r !== rots[i - 1]));
  ok('and every angle is inside one turn, because `spinDegAt` wraps it',
    rots.every((r) => r >= 0 && r < 360));

  /* Said as the reader would report it: a full revolution takes
   * `clockGlyphSpinSeconds` of REAL time, so at the shipped pace the angle after
   * exactly one period of storm time is back where it started. */
  const first = clockFrameAt(e, span.from).storms[0].state;
  /* ==> THE PERIOD IS ASKED FOR THROUGH `toStormMs`, NEVER RE-DERIVED HERE.
   * <== `config/constants.js` says outright that the ratio is applied in one
   * file and one file only, because the reverted build's whole failure was a
   * conversion written out by hand at a call site. The first draft of this
   * assertion wrote it out by hand and was wrong by a factor of a thousand. */
  const oneTurnMs = toStormMs(SEASONS.clockGlyphSpinSeconds * 1000);
  const later = clockFrameAt(e, span.from + oneTurnMs).storms[0].state;
  ok(`one revolution is ${SEASONS.clockGlyphSpinSeconds} real seconds of storm `
    + 'time, and the mark comes back to the angle it started at',
    Math.abs((later.spinDeg - first.spinDeg + 360) % 360) < 1e-6);

  /* ==> AND A SOUTHERN STORM WOULD TURN THE OTHER WAY. <== Nothing in this
   * archive is southern — every storm in HURDAT2 is Atlantic or East Pacific —
   * so this is driven on the clock's own answer rather than on a fixture, and
   * it exists because step 13 brings IBTrACS and a glyph spinning backwards
   * over Australia is the kind of wrong only somebody who knows storms catches
   * (§57.67c). */
  const north = { phase: 'running', spin: 1, spinDeg: 30, lon: -80, lat: 25, category: 3, nature: 'tropical' };
  const south = { ...north, spin: -1, lat: -25 };
  setSeasonHead(map, [entry(KATRINA)], new Map([[KATRINA.id, north]]));
  const nIcon = map.data().features[0].properties.icon;
  setSeasonHead(map, [entry(KATRINA)], new Map([[KATRINA.id, south]]));
  const sIcon = map.data().features[0].properties.icon;
  ok('the two hemispheres name two different marks, because the artwork is '
    + 'mirrored', nIcon !== sIcon);

  clearSeasonHead(map);
}

/* =========================================================================
 * 6. THE SPRITE ATLAS
 * ====================================================================== */
section('6. One image per colour, built once');

{
  const e = [entry(KATRINA)];
  const span = clockSpan(e);
  const map = fakeMap();
  ensureSeasonHead(map);

  for (let i = 0; i <= 60; i++) {
    setSeasonHead(map, e, cutAt(e, span.from + (span.spanMs * i) / 60));
  }

  ok(`sixty-one pushes built ${map.images.size} images, not sixty-one`,
    map.images.size > 0 && map.images.size <= 10);
  eq('and it uploaded each of them exactly once', map.adds.length, map.images.size);

  const one = [...map.images.values()][0];
  eq('==> THE DOWNSCALE IS THE PIXEL RATIO, WHICH IS WHAT MAKES THE MARK THE '
    + 'SAME SIZE AS THE 3D ONE <== — the image is handed over as device pixels '
    + 'per CSS pixel rather than resized with an icon-size nobody can trace',
    one.opts.pixelRatio, SEASONS.clockHeadTexturePx / SIZE.stormDot3dPx);

  const before = map.adds.length;
  for (let i = 0; i <= 60; i++) {
    setSeasonHead(map, e, cutAt(e, span.from + (span.spanMs * i) / 60));
  }
  eq('and a second run through her life uploads nothing at all, because the '
    + 'atlas already holds them', map.adds.length, before);

  clearSeasonHead(map);
}

{
  /* ==> NO CANVAS COSTS THE MARK AND NOTHING ELSE. <== The headless suites drive
   * these layers with no `document` at all, and `map/layers/genesis.js` records
   * what a canvas builder throwing in that world costs: it took the whole layer
   * engine down, every storm layer and not only its own. The trail, the dots and
   * the scrubber all have to survive a map that cannot make an image.
   *
   * Driven by taking the stand-in away rather than by trusting the guard, which
   * is the only version of this assertion that can fail. */
  const e = [entry(KATRINA)];
  const span = clockSpan(e);
  const map = fakeMap();
  ensureSeasonHead(map);

  const saved = globalThis.document;
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a);
  delete globalThis.document;
  let threw = null;
  try {
    setSeasonHead(map, e, cutAt(e, span.from + span.spanMs / 2));
  } catch (err) {
    threw = err;
  }
  globalThis.document = saved;
  console.warn = warn;

  eq('a map with no canvas to draw on does not throw', threw, null);
  eq('it simply draws no mark', map.data().features.length, 0);
  eq('and it did not put a broken image in the atlas', map.adds.length, 0);

  /* ==> AND IT SAYS NOTHING, WHICH IS WHAT SEPARATES THE GUARD FROM THE CATCH
   * BELOW IT. <== The `try` around the canvas would swallow the same throw and
   * answer the same "no mark" — mutation proved that, by deleting the guard and
   * leaving this section green. The difference is volume: without the guard,
   * every ticked storm warns on every step, which is ten times a second per
   * storm in a headless run, and a log that noisy is a log nobody reads the
   * real warning in. */
  eq('and it does not warn once per storm per step while doing it',
    warned.length, 0);

  clearSeasonHead(map);
}

/* =========================================================================
 * 7. FOCUS, TEARDOWN AND THE BROKEN PATHS
 * ====================================================================== */
section('7. Focus, leaving, and the paths that must not throw');

{
  const e = [entry(KATRINA)];
  const span = clockSpan(e);
  const map = fakeMap();
  ensureSeasonHead(map);
  setSeasonHead(map, e, cutAt(e, span.from + span.spanMs / 2));

  /* ==> A GHOSTED TRACK MUST NOT WEAR A FULL-STRENGTH HEAD. <== The tracks and
   * the dots both dim when a storm is opened, and a bright mark on the end of a
   * ghost line reads as a rendering fault rather than as emphasis — which is
   * the whole argument `season-focus.js` exists to make. */
  setSeasonHeadFocus(map, 'AL122005');
  const expr = map.paintOf('season-head', 'icon-opacity');
  ok('focusing a storm hands the heads an expression rather than a number',
    Array.isArray(expr));
  ok('and it keys on the feature id, like every other archive layer',
    JSON.stringify(expr).includes('AL122005'));

  setSeasonHeadFocus(map, null);
  ok('and letting go puts them all back to one number',
    !Array.isArray(map.paintOf('season-head', 'icon-opacity')));

  clearSeasonHead(map);
  eq('leaving the archive takes every mark off', map.data().features, []);
  eq('and forgets the focus with it', __internals.focus(), null);

  const bare = fakeMap();
  setSeasonHead(bare, e, cutAt(e, span.from + span.spanMs / 2));
  clearSeasonHead(bare);
  setSeasonHeadFocus(bare, 'AL122005');
  ok('pushing to a map with no source is a no-op, not a crash', true);
  pass++;
  setSeasonHeadFocus(null, null);

  /* A storm the cut says nothing about draws no head, which is the one place
   * this file differs from the trail next door: a track with no cut state draws
   * WHOLE (§57.67e rule 2, so the drift is visible), and a head has no whole to
   * draw — there is no moment for it to stand at. */
  ensureSeasonHead(map);
  setSeasonHead(map, e, new Map());
  eq('a storm missing from the cut gets no mark', map.data().features.length, 0);
  clearSeasonHead(map);
}

/* ========================================================================= */
console.log(`\n${fails.length ? '✗' : '✓'} ${pass} assertions pass — the season clock's head`);
if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
