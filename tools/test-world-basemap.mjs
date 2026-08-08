#!/usr/bin/env node
/**
 * test-world-basemap.mjs — a world's basemap manifest (map/style.js, config/worlds/).
 *
 * ZERO DEPENDENCIES, plain `node tools/test-world-basemap.mjs`, same as every
 * other suite here (§12 — this project has no toolchain by design).
 *
 * TWO THINGS, AND THE FIRST ONE IS THE POINT.
 *
 * 1. ==> SKY DOES NOT MOVE. <== `buildStyle` grew two new parameters (`admin`,
 *    and a third plate colour) and the shipped app passes neither. Every
 *    assertion in the first section is there to prove the app's own basemap came
 *    out of this change byte for byte — because "I added a knob, the default is
 *    the old behaviour" is a claim, and the whole reason it is safe to add knobs
 *    to a live app is that something checks the claim.
 *
 * 2. THE NAME LADDER'S OWN INVARIANT, ENFORCED RATHER THAN WRITTEN DOWN.
 *    `ADMIN.nameLadder` states it in prose: from the moment the cage starts
 *    dissolving until cities arrive, at least one name is on screen at EVERY
 *    zoom. Deep deletes a rung from that ladder (no state names), so it has to
 *    lengthen the rung below. A gap there is invisible in the constants and
 *    obvious on a phone, which is the worst possible place to find it — so this
 *    samples the whole zoom range instead of trusting the six numbers.
 *
 * WHAT THIS CANNOT PROVE: that MapLibre accepts the style. An expression can be
 * structurally reasonable here and still be rejected at load — which happened,
 * and rejected the WHOLE style rather than one layer. `tools/csp-check.mjs` and
 * the headless harness are what catch that. The one specific shape that broke is
 * asserted below anyway, because it cost an hour.
 */

import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.chdir(ROOT);

let pass = 0;
const failures = [];
const ok = (c, m) => { c ? pass++ : failures.push(m); };
const section = (n) => console.log(`\n  ${n}`);

const { buildStyle } = await import('../map/style.js');
/* A world that wants plates brings its own builders — see map/style-plates.js.
 * The test stands in for `proto/shell.js`, which is the only real caller. */
const { plateLayers, plateLabelLayers } = await import('../map/style-plates.js');
const { DEEP_WORLD } = await import('../config/worlds/deep.js');
const { SKY_WORLD } = await import('../config/worlds/sky.js');
const { ADMIN, ZOOM } = await import('../config/constants.js');
const { PLATE_LINE } = await import('../config/plate-line.js');
const { SIZE } = await import('../config/tokens.js');

/* ---------------------------------------------------------------------------
 * A MINIMAL EXPRESSION EVALUATOR
 *
 * Only the shapes this file actually produces: a literal, `byZoom`'s
 * interpolate, and the `case` on `tier` that sits inside its stop values. Not a
 * general MapLibre evaluator and must not become one — if a style ever needs
 * more than this to be testable, the style has grown an expression too clever to
 * reason about.
 * ------------------------------------------------------------------------- */
function evalExpr(e, { zoom = 0, props = {} } = {}) {
  if (typeof e === 'number' || typeof e === 'string' || e == null) return e;
  if (!Array.isArray(e)) return e;
  const [op] = e;
  if (op === 'interpolate') {
    const stops = e.slice(3);
    const zs = [];
    for (let i = 0; i < stops.length; i += 2) zs.push([stops[i], stops[i + 1]]);
    if (zoom <= zs[0][0]) return evalExpr(zs[0][1], { zoom, props });
    if (zoom >= zs[zs.length - 1][0]) return evalExpr(zs[zs.length - 1][1], { zoom, props });
    for (let i = 1; i < zs.length; i++) {
      if (zoom <= zs[i][0]) {
        const [z0, v0] = zs[i - 1];
        const [z1, v1] = zs[i];
        const t = (zoom - z0) / (z1 - z0);
        const a = evalExpr(v0, { zoom, props });
        const b = evalExpr(v1, { zoom, props });
        return a + (b - a) * t;
      }
    }
  }
  if (op === 'case') {
    for (let i = 1; i < e.length - 1; i += 2) {
      if (evalExpr(e[i], { zoom, props })) return evalExpr(e[i + 1], { zoom, props });
    }
    return evalExpr(e[e.length - 1], { zoom, props });
  }
  if (op === '==') return evalExpr(e[1], { zoom, props }) === evalExpr(e[2], { zoom, props });
  if (op === 'get') return props[e[1]];
  if (op === 'to-number') return Number(evalExpr(e[1], { zoom, props }));
  if (op === 'coalesce') {
    for (let i = 1; i < e.length; i++) {
      const v = evalExpr(e[i], { zoom, props });
      if (v !== undefined && v !== null) return v;
    }
    return null;
  }
  /* --- string surgery, for the admin-suffix stripper ----------------------
   * MapLibre's semantics EXACTLY, because the bug this section exists to catch
   * lives in the arithmetic between them: `index-of` returns -1 on a miss (it
   * does NOT return undefined), and `slice` is JS `String.prototype.slice`,
   * which treats a negative end index as counting back from the end. Weaken
   * either one here and the test stops being able to see the failure. */
  if (op === 'index-of') {
    return String(evalExpr(e[2], { zoom, props })).indexOf(String(evalExpr(e[1], { zoom, props })));
  }
  if (op === 'slice') {
    return String(evalExpr(e[1], { zoom, props }))
      .slice(evalExpr(e[2], { zoom, props }), evalExpr(e[3], { zoom, props }));
  }
  if (op === 'length') return String(evalExpr(e[1], { zoom, props })).length;
  if (op === '-') return evalExpr(e[1], { zoom, props }) - evalExpr(e[2], { zoom, props });
  if (op === '>') return evalExpr(e[1], { zoom, props }) > evalExpr(e[2], { zoom, props });
  if (op === 'all') {
    for (let i = 1; i < e.length; i++) if (!evalExpr(e[i], { zoom, props })) return false;
    return true;
  }
  if (op === 'in') {
    const hay = evalExpr(e[2], { zoom, props });
    return (Array.isArray(hay) ? hay : String(hay)).includes(evalExpr(e[1], { zoom, props }));
  }
  if (op === 'literal') return e[1];
  if (op === 'let') {
    const scoped = { ...props };
    for (let i = 1; i < e.length - 1; i += 2) {
      scoped['@' + e[i]] = evalExpr(e[i + 1], { zoom, props: scoped });
    }
    return evalExpr(e[e.length - 1], { zoom, props: scoped });
  }
  if (op === 'var') return props['@' + e[1]];
  throw new Error('the evaluator does not know "' + op + '" — see the note above');
}

/** How many zoom-driven subexpressions are nested inside one property. MapLibre
 *  allows exactly one, and more than one rejects the entire style. */
function zoomExprCount(e) {
  if (!Array.isArray(e)) return 0;
  let n = e[0] === 'interpolate' || e[0] === 'step' ? 1 : 0;
  for (const sub of e.slice(1)) n += zoomExprCount(sub);
  return n;
}

const sky = buildStyle({ palette: SKY_WORLD.map, plates: SKY_WORLD.plates, admin: SKY_WORLD.admin });
const deep = buildStyle({
  palette: DEEP_WORLD.map,
  plates: DEEP_WORLD.plates,
  admin: DEEP_WORLD.admin,
  plateLayers,
  plateLabelLayers,
});
const bare = buildStyle();
const layer = (style, id) => style.layers.find((l) => l.id === id);
const ids = (style) => style.layers.map((l) => l.id);

/* ---------------------------------------------------------------------------
 * SKY DOES NOT MOVE
 * ------------------------------------------------------------------------- */
section('the shipped app is unchanged');

/* The app calls `createGlobe` with no world at all, so this is the real one. */
ok(ids(bare).includes('admin-state'), 'the app still draws state borders');
ok(ids(bare).includes('place-state'), 'the app still draws state names');
ok(layer(bare, 'place-country').maxzoom === ADMIN.nameLadder.countryOut[1],
  'the app still retires country names at the end of their fade');
ok(!ids(bare).some((id) => id.startsWith('plate-')), 'the app draws no plate boundaries');
ok(!bare.sources.plates, 'the app declares no plate seam source');
ok(!bare.sources['plate-labels'], 'the app declares no plate label source');

/* Sky, as a world descriptor, must be indistinguishable from no world at all on
 * everything the admin block touches — it declares no `admin`, so it is the
 * default path, and if these ever diverge the default stopped being the default. */
ok(JSON.stringify(ids(sky)) === JSON.stringify(ids(bare)), 'Sky and no-world produce the same layer list');
ok(
  JSON.stringify(layer(sky, 'place-country')) === JSON.stringify(layer(bare, 'place-country')),
  'Sky and no-world produce an identical country-name layer'
);

/* ---------------------------------------------------------------------------
 * DEEP DROPS THE STATE FURNITURE
 * ------------------------------------------------------------------------- */
section('Deep: no state lines, no state names');

ok(!ids(deep).includes('admin-state'), 'Deep draws no state borders');
ok(!ids(deep).includes('place-state'), 'Deep draws no state names');
/* ABSENT, NOT HIDDEN. A world declining a class of furniture should not leave
 * MapLibre laying it out behind a `visibility: none`, and a hidden layer is also
 * something a stray `setLayoutProperty` could switch back on. */
ok(
  !deep.layers.some((l) => l.layout && l.layout.visibility === 'none'),
  'nothing on Deep is merely hidden'
);
ok(ids(deep).includes('admin-country'), 'Deep keeps national borders');
ok(ids(deep).includes('place-city'), 'Deep keeps city names');

/* ---------------------------------------------------------------------------
 * NEVER A NAMELESS GLOBE
 * ------------------------------------------------------------------------- */
section('the name ladder holds with a rung removed');

const country = layer(deep, 'place-country');
ok(country.maxzoom === undefined, 'Deep does not retire the country-name layer early');

/* ==> THE MAXZOOM AND THE OPACITY HAVE TO AGREE, AND THIS IS WHY BOTH ARE
 * CHECKED. <== Sustaining the fade while leaving `maxzoom` in place would retire
 * the layer at z5 no matter what the opacity said — the same bug in a different
 * property, and invisible in the constants. */
let gap = null;
for (let z = ADMIN.nameLadder.countryIn[1]; z <= ZOOM.max; z += 0.05) {
  const o = evalExpr(country.paint['text-opacity'], { zoom: z });
  if (!(o > 0.99)) { gap = z; break; }
}
ok(gap === null, `country names hold at full strength from z${ADMIN.nameLadder.countryIn[1]} to z${ZOOM.max}${gap === null ? '' : ` (dropped at z${gap.toFixed(2)})`}`);

/* And the rise is IDENTICAL to Sky's, deliberately: a world changes when a rung
 * ENDS, never when it begins. */
const skyCountry = layer(sky, 'place-country');
for (const z of [3.4, 3.6, 3.8, 4.0]) {
  const a = evalExpr(country.paint['text-opacity'], { zoom: z });
  const b = evalExpr(skyCountry.paint['text-opacity'], { zoom: z });
  ok(Math.abs(a - b) < 1e-9, `country names arrive at the same rate as Sky's at z${z}`);
}

/* ---------------------------------------------------------------------------
 * THE STATE-NAME HANDOFF — the rung that used to have no exit
 * ------------------------------------------------------------------------- */
section('state names arrive, then leave for cities');

const stateName = layer(bare, 'place-state');
const cityName = layer(bare, 'place-city');

ok(stateName.maxzoom === ADMIN.nameLadder.stateOut[1],
  'state names are retired at the exact zoom their fade reaches nothing');

/* THE OVERLAP IS THE LADDER. If states were fully gone before cities were fully
 * up there would be a band with neither, which is the same nameless-globe
 * failure the country rung is checked for above. */
ok(ADMIN.nameLadder.stateOut[0] > ADMIN.cityIn,
  'states start leaving only after cities have started arriving');
ok(ADMIN.nameLadder.stateOut[1] > ADMIN.cityIn + ADMIN.fadeSpan,
  'states are still on screen when cities reach full strength');

for (const z of [ADMIN.nameLadder.stateIn[1], ADMIN.cityIn, ADMIN.nameLadder.stateOut[0]]) {
  ok(evalExpr(stateName.paint['text-opacity'], { zoom: z }) > 0.99,
    `state names hold at full strength at z${z}`);
}
ok(evalExpr(stateName.paint['text-opacity'], { zoom: ADMIN.nameLadder.stateOut[1] }) < 0.01,
  'state names are gone by the end of their fade');

/* ==> DRAWING ORDER IS THE COLLISION RULE. <== MapLibre places symbols from the
 * top layer down and first placed wins, so a city label only survives a crowded
 * coast if its layer sits ABOVE the bold state names. This was the other way
 * round on 2026-08-07 and city names vanished over Japan. */
ok(ids(bare).indexOf('place-city') < ids(bare).indexOf('place-state'),
  'city names are placed before state names, so a town keeps its label');

/* ---------------------------------------------------------------------------
 * THE ADMIN SUFFIX STRIPPER
 * ------------------------------------------------------------------------- */
section('"Shimane Prefecture" reads as SHIMANE, and TEXAS stays TEXAS');

const stateField = stateName.layout['text-field'];
const rendered = (name) => evalExpr(stateField, { zoom: 5, props: { 'name:en': name } });

/* The words that carry nothing. All three were on screen in one frame over
 * East Asia, each wrapping to two lines to say what the map already said. */
for (const [raw, want] of [
  ['Shimane Prefecture', 'Shimane'],
  ['Osaka Prefecture', 'Osaka'],
  ['Jilin Province', 'Jilin'],
  ['South Chungcheong Province', 'South Chungcheong'],
  ['Gangwon State', 'Gangwon'],
  ['Jeonbuk State', 'Jeonbuk'],
]) {
  ok(rendered(raw) === want, `"${raw}" reads as "${want}"`);
}

/* ==> THE REGRESSION THIS SECTION EXISTS FOR. <== A name one character shorter
 * than the suffix makes `index-of`'s -1 miss equal `length - suffixLength`, the
 * end-of-string test passes on a word that never contained the suffix, and
 * `slice(0, -1)` eats the last letter. " State" is six characters, so every
 * five-letter state was at risk. Do not delete these. */
for (const name of ['Texas', 'Iowa', 'Ohio', 'Utah', 'Kansas', 'Washington', 'Idaho', 'Maine']) {
  ok(rendered(name) === name, `"${name}" is left alone`);
}

/* Names where the noun IS the name, and names that never had one. */
for (const name of [
  'Free State', 'Northern Territory', 'State of Palestine', 'Sakha Republic',
  'Chagang', 'Ryanggang', 'Jeju-do', 'Guangxi Zhuang Autonomous Region',
]) {
  ok(rendered(name) === name, `"${name}" keeps every word it came with`);
}

/* A feature with no name in any of the three fields must produce an empty
 * string, not null — `length` on null is a hard expression error, and a hard
 * error takes the entire layer down rather than dropping one label. */
ok(evalExpr(stateField, { zoom: 5, props: {} }) === '',
  'a nameless feature yields an empty label, not a broken layer');

/* Country and city names are UNTOUCHED. The stripper is a state-level fix and
 * must not have become a global rewrite of every label on the map. */
ok(JSON.stringify(cityName.layout['text-field']) ===
   JSON.stringify(layer(bare, 'place-country').layout['text-field']),
  'city and country names still share the plain name field');
ok(JSON.stringify(stateField) !== JSON.stringify(cityName.layout['text-field']),
  'only state names go through the stripper');

/* ---------------------------------------------------------------------------
 * THE MAGMA STACK
 * ------------------------------------------------------------------------- */
section('three passes, widest to brightest');

const glow = layer(deep, 'plate-glow');
const core = layer(deep, 'plate-core');
const hot = layer(deep, 'plate-hot');
ok(glow && core && hot, 'all three magma passes exist');

/* THE ORDER IN THE ARRAY IS THE ORDER ON SCREEN. A bright core drawn UNDER a
 * wide dim band is not a core, it is a smudge. */
ok(
  ids(deep).indexOf('plate-glow') < ids(deep).indexOf('plate-core') &&
    ids(deep).indexOf('plate-core') < ids(deep).indexOf('plate-hot'),
  'the passes are drawn dimmest-first'
);

/* ==> THE WIDTHS MUST STEP, NOT JUST DIFFER. <== The first version of this stack
 * had three passes at effectively two widths — the body and the heat both landed
 * near 5.5 px because the heat derived from `coastWidthGlow` while the body
 * derived from `coastWidthCore`. Three layers at two widths is two layers, and it
 * was reported on glass as "one same-colour line". A blur fills a small gap, so
 * each pass has to be a MULTIPLE of the one inside it, not merely wider. */
let crossed = null;
let flat = null;
for (let z = ZOOM.min; z <= ZOOM.max; z += 0.1) {
  const w = {
    heat: evalExpr(glow.paint['line-width'], { zoom: z }),
    body: evalExpr(core.paint['line-width'], { zoom: z }),
    hot: evalExpr(hot.paint['line-width'], { zoom: z }),
  };
  if (!(w.hot < w.body && w.body < w.heat)) { crossed = { z, w }; break; }
  /* Each step at least doubles. Below that the blur closes the gap and the three
   * passes read as one soft edge. */
  if (!(w.body >= w.hot * 2 && w.heat >= w.body * 2)) { flat = { z, w }; break; }
}
ok(crossed === null, `hot < body < heat at every zoom${crossed ? ` (crossed at z${crossed.z.toFixed(1)}: ${JSON.stringify(crossed.w)})` : ''}`);
ok(flat === null, `each pass is at least twice the one inside it${flat ? ` (too close at z${flat.z.toFixed(1)}: ${JSON.stringify(flat.w)})` : ''}`);

/* The ratios live in ONE place so the steps cannot drift back together. */
ok(SIZE.plateStack && SIZE.plateStack.hot < SIZE.plateStack.body && SIZE.plateStack.body < SIZE.plateStack.heat,
  'SIZE.plateStack states the stair-step in one place');

/* The core is the one pass that is not blurred. That is what makes it read as a
 * hard bright line inside a soft one, which is what makes it read as heat. */
ok(hot.paint['line-blur'] === undefined, 'the hot core is unblurred');
ok(glow.paint['line-blur'] !== undefined && core.paint['line-blur'] !== undefined, 'both outer passes are blurred');

/* NOTHING ANIMATES DOWN HERE. A paint property that varied on anything but zoom
 * would mean something is driving it per frame, which means a full map redraw
 * per frame. The shimmer belongs to the Three shader and only there. */
for (const l of [glow, core, hot]) {
  for (const [k, v] of Object.entries(l.paint)) {
    ok(zoomExprCount(v) <= 1, `${l.id}.${k} holds at most one zoom expression`);
  }
}

/* ---------------------------------------------------------------------------
 * THE PLATE NAME LAYERS
 * ------------------------------------------------------------------------- */
section('plate names, three bands, paired');

const bandLayers = PLATE_LINE.labelBands.map((b) => layer(deep, `plate-name-${b.id}`));
ok(bandLayers.every(Boolean), `every displacement band has a layer (${PLATE_LINE.labelBands.length})`);
ok(bandLayers.every((l) => l.source === 'plate-labels'), 'all bands read the label source');
ok(deep.sources['plate-labels'] && deep.sources['plate-labels'].data.features.length === 0,
  'the label source is declared EMPTY, to be filled by map/plate-seams.js');

/* ==> `line-center`, NOT `line`. THIS IS THE PLACEMENT DECISION. <== With `line`
 * MapLibre repeats a label every `symbol-spacing` pixels and places each side
 * independently, which gave five copies of AFRICA down one ridge with no
 * relationship between the two sides. `line-center` places exactly ONE label per
 * feature at its centre, which is what pairs the two names. */
for (const l of bandLayers) {
  ok(l.layout['symbol-placement'] === 'line-center', `${l.id} places one label at the centre of its window`);
  ok(l.layout['symbol-spacing'] === undefined, `${l.id} sets no symbol-spacing — there is nothing to repeat`);
}

/* ==> EACH BAND IS CONFINED TO ITS OWN ZOOM WINDOW, AND THAT IS A COLLISION FIX.
 * <== All three shared one `minzoom` at first, on the reasoning that opacity
 * decides visibility. It does — and MapLibre still PLACES a symbol whose opacity
 * is zero. Measured at z4.4: nine invisible `near`-band labels were laid out and,
 * because `near` is topmost and placement runs top-down, they won every collision
 * against the `mid` labels actually on screen. */
const halfOverlap = PLATE_LINE.bandOverlap / 2;
for (let i = 0; i < bandLayers.length; i++) {
  const l = bandLayers[i];
  const expectMin = i === 0 ? ZOOM.min : Math.max(ZOOM.min, PLATE_LINE.labelBands[i - 1].until - halfOverlap);
  ok(Math.abs(l.minzoom - expectMin) < 1e-9, `${l.id} starts at its own fade-in, not at the ladder floor`);
  if (i < bandLayers.length - 1) {
    ok(l.maxzoom !== undefined, `${l.id} stops being laid out once it has faded`);
  } else {
    ok(l.maxzoom === undefined, `${l.id} survives to the top of the zoom range`);
  }
}

/* ==> THE ONE THAT COST AN HOUR. <== `['*', bandRamp, tierRamp]` is two
 * zoom-driven subexpressions in one property, and MapLibre does not disable that
 * layer — it rejects the entire style, so `style.load` never fires and the map
 * draws nothing at all. The product is folded in JavaScript instead. */
for (const l of bandLayers) {
  ok(zoomExprCount(l.paint['text-opacity']) === 1, `${l.id} text-opacity holds exactly ONE zoom expression`);
}

/* NO `text-offset`. The side a name sits on is carried by the geometry, because
 * MapLibre's keep-upright flip takes `text-offset` with it and would put the
 * Pacific plate over California the moment the globe is turned. Measured in a
 * browser; see lib/plate-lines.js. */
for (const l of bandLayers) {
  ok(l.layout['text-offset'] === undefined, `${l.id} uses no text-offset`);
}

/* NO COLLISION PADDING. The two names of a seam sit tens of pixels apart on
 * purpose — that closeness is what lets both be read in one glance — and the
 * default 2 px of padding is enough at that separation to make the pair collide
 * with ITSELF and drop one half. */
for (const l of bandLayers) {
  ok(l.layout['text-padding'] === 0, `${l.id} adds no collision padding`);
}

/* THE BANDS HAND OVER RATHER THAN OVERLAP. Two copies of one name at full
 * strength in the same place read as one bold double-struck word. */
const t1 = { tier: 1 };
const sumAt = (z) => bandLayers.reduce((s, l) => s + evalExpr(l.paint['text-opacity'], { zoom: z, props: t1 }), 0);
let doubled = null;
let blank = null;
for (let z = PLATE_LINE.tierIn[1] + PLATE_LINE.tierFade; z <= ZOOM.max; z += 0.05) {
  const total = sumAt(z);
  if (total > 1.001) { doubled = { z, total }; break; }
  if (total < 0.99) { blank = { z, total }; break; }
}
ok(doubled === null, `the bands never sum past one label's worth${doubled ? ` (${doubled.total.toFixed(2)} at z${doubled.z.toFixed(2)})` : ''}`);
ok(blank === null, `a tier-1 name is always at full strength once it has arrived${blank ? ` (dipped to ${blank.total.toFixed(2)} at z${blank.z.toFixed(2)})` : ''}`);

/* The tiers arrive in order, and none of them is on screen at the planet band —
 * MapLibre is fully transparent below `DIVE.zSpace`, so a name there would be
 * laid out and paid for and invisible. */
ok(
  PLATE_LINE.tierIn[1] < PLATE_LINE.tierIn[2] && PLATE_LINE.tierIn[2] < PLATE_LINE.tierIn[3],
  'the tiers arrive biggest-first'
);
for (const tier of [1, 2, 3]) {
  const total = bandLayers.reduce(
    (s, l) => s + evalExpr(l.paint['text-opacity'], { zoom: ZOOM.planet, props: { tier } }), 0
  );
  ok(total === 0, `tier ${tier} draws nothing at the planet band`);
}

/* The band table itself has to be ordered and to cover the range, or a zoom
 * somewhere between two bands has no label geometry sized for it. */
for (let i = 1; i < PLATE_LINE.labelBands.length; i++) {
  const prev = PLATE_LINE.labelBands[i - 1];
  const cur = PLATE_LINE.labelBands[i];
  ok(prev.until !== undefined, `band ${prev.id} states one handover zoom`);
  ok(cur.offsetDeg < prev.offsetDeg, `band ${cur.id} sits closer to the seam than ${prev.id}`);
  ok(cur.anchorDeg < prev.anchorDeg, `band ${cur.id} places names more often than ${prev.id}`);
  ok(cur.windowDeg < prev.windowDeg, `band ${cur.id} rides a shorter window than ${prev.id}`);
}
ok(
  PLATE_LINE.labelBands[PLATE_LINE.labelBands.length - 1].until === undefined,
  'the last band states no handover — it runs to the top of the range'
);

/* --- report --------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${pass} assertions passed`);
console.log('  (the manifest and the ramps; whether MapLibre ACCEPTS the style is the headless run)');
