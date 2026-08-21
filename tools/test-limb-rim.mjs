/**
 * test-limb-rim.mjs — the glass rim at the horizon (map/limb-rim.js).
 *
 * WHY THIS FILE EXISTS. This layer has no assertion of its own and cannot
 * throw. It paints onto its own canvas above the basemap, and every way it can
 * be wrong renders as "that looks a bit off" on somebody's monitor weeks later:
 *
 *   1. THE PEAK IS THE PLANET'S EDGE. The whole claim this layer makes is
 *      "the world stops HERE". If the brightest stop of the gradient is not at
 *      the measured limb radius, the ring is a decoration sitting near the
 *      horizon rather than on it, and nothing else in the app would notice.
 *   2. IT ASKS MAPLIBRE WHERE THE LIMB IS. Deriving it from the Three camera
 *      instead is the obvious "simplification" and it is wrong by 14-70 px
 *      across the band this layer lives in, because the two globes are matched
 *      at the screen centre and run different fields of view.
 *   3. IT HANDS OFF FROM THE CAGE ON THE CAGE'S OWN BAND. A private band here
 *      would drift and leave either two edges on screen or none.
 *   4. THE LIT ARC FLIPS SIDES BETWEEN THE THEMES. Unifying it is exactly the
 *      kind of tidying a later pass does, and it puts the shading on the wrong
 *      half of a near-white globe.
 *   5. IT GOES OUT WHEN THE HORIZON LEAVES THE SCREEN. Otherwise a phone pays
 *      for an annulus fill at every zoom for a ring nobody can see.
 *
 * NO DOM AND NO WEBGL. The canvas, its 2D context and a MapLibre-shaped map are
 * stubbed below, and the stub RECORDS rather than draws.
 */

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error('  FAIL  ' + msg);
  }
}

globalThis.window = { innerWidth: 1600, innerHeight: 900 };

/* --- the stub canvas ------------------------------------------------------
 * Records every gradient it is asked to build, with the geometry it was built
 * from, plus the paths that were filled. That is enough to answer all five
 * questions above without a pixel existing anywhere. */
function stubCanvas() {
  const grads = [];
  const arcs = [];
  const fills = [];
  let cur = null;
  const ctx = {
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      cur = { kind: 'radial', x0, y0, r0, x1, y1, r1, stops: [] };
      grads.push(cur);
      return { addColorStop: (o, c) => cur.stops.push([o, c]) };
    },
    createLinearGradient(x0, y0, x1, y1) {
      cur = { kind: 'linear', x0, y0, x1, y1, stops: [] };
      grads.push(cur);
      return { addColorStop: (o, c) => cur.stops.push([o, c]) };
    },
    beginPath() {
      ctx._path = [];
    },
    arc(x, y, r) {
      (ctx._path ||= []).push({ x, y, r });
      arcs.push({ x, y, r });
    },
    fill(rule) {
      fills.push({ rule, path: (ctx._path || []).slice(), grad: cur });
    },
    clearRect() {},
    set fillStyle(_v) {},
    _path: [],
  };
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    _grads: grads,
    _arcs: arcs,
    _fills: fills,
  };
}

/* --- the stub map ---------------------------------------------------------
 * `isLocationOccluded` is the ONE oracle map/limb-rim.js is allowed to ask, so
 * the stub implements it honestly: a point on the unit sphere is hidden when it
 * has rotated past the tangent seen from a camera `dist` radii out, which is
 * the cos = 1/dist test. `project` is the matching perspective divide. Between
 * them the limb lands at a radius the test can compute independently, which is
 * what makes assertion 1 mean anything — a stub that simply handed back a
 * number would let the code and the test share one wrong assumption. */
const DEG = Math.PI / 180;

function stubMap(dist) {
  const H = window.innerHeight;
  const W = window.innerWidth;
  /* Focal length in pixels. Arbitrary but fixed; every screen radius below is
   * derived from it rather than typed. */
  const f = H / 2 / Math.tan((36.87 * DEG) / 2);
  const unit = (lon, lat) => {
    const p = lat * DEG;
    const l = lon * DEG;
    return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
  };
  return {
    _calls: 0,
    getCenter: () => ({ lng: 0, lat: 0 }),
    project([lon, lat]) {
      const [x, y, z] = unit(lon, lat);
      const depth = dist - z;
      return { x: W / 2 + (f * x) / depth, y: H / 2 - (f * y) / depth };
    },
    transform: {
      isLocationOccluded({ lng, lat }) {
        stubMapCalls.n++;
        const [, , z] = unit(lng, lat);
        return z < 1 / dist;
      },
    },
    /** The limb's true screen radius at this distance: the tangent point sits
     *  at cos = 1/d, so its projected offset is f*sin/(d-cos). Computed here so
     *  the assertions never quote a number the code produced. */
    trueLimbPx() {
      const cosT = 1 / dist;
      const sinT = Math.sqrt(1 - cosT * cosT);
      return (f * sinT) / (dist - cosT);
    },
  };
}
const stubMapCalls = { n: 0 };

const { createLimbRim } = await import('../map/limb-rim.js');
const { setThemeMode, MODE } = await import('../config/theme.js');
const { RIM, DIVE } = await import('../config/constants.js');
const { DARK, LIGHT } = await import('../config/tokens.js');
const { smoothstep } = await import('../lib/geo.js');

/** Mount fresh and paint one frame. */
const paint = (p, dist = 3) => {
  const cv = stubCanvas();
  const map = stubMap(dist);
  const rim = createLimbRim(cv, map);
  cv._map = map;
  rim.update({ p });
  cv._rim = rim;
  return cv;
};

console.log('limb-rim');

/* 1 — THE PEAK IS THE PLANET'S EDGE. ---------------------------------------
 * The base fill is a radial gradient from `r - innerPx` to `r + outerPx`, and
 * the stop carrying full alpha must land where the limb actually is. This is
 * checked against the STUB'S OWN geometry, not against anything the module
 * returned.
 *
 * MUTATION: change `edge` in map/limb-rim.js to a round 0.5 (or to any fixed
 * fraction) and this fails at every distance. Verified. */
setThemeMode(MODE.DARK);
for (const dist of [3, 2.4, 2.0]) {
  const cv = paint(1, dist);
  const trueR = cv._map.trueLimbPx();
  const base = cv._grads.find((g) => g.kind === 'radial');
  ok(!!base, `d=${dist}: a base radial gradient was built`);
  const rIn = base.r0;
  const rOut = base.r1;
  /* ==> NOTHING OUTSIDE THE PLANET. <== This is the rule the first version
   * broke: it put 44 px of bloom outside the limb against 10 px inside, and on
   * glass that reads as a hoop AROUND the globe rather than as light ON it.
   * A halo outside the silhouette is an atmosphere; this is meant to be glass.
   * `bleedPx` is the couple of pixels that keep the edge from being a razor
   * cut, and it is the entire allowance.
   * MUTATION: put the reach back on the outside and this fails at every
   * distance. Verified. */
  ok(
    rOut - trueR <= RIM.bleedPx + 0.51,
    `d=${dist}: nothing is painted outside the limb but the edge softening`
  );
  ok(
    trueR - rIn > RIM.bleedPx * 2,
    `d=${dist}: and the highlight itself lives inside the planet`
  );
  /* The reach scales with the ball, clamped. A fixed pixel width would be a
   * different fraction of the globe at every zoom, which is the one thing a
   * limb highlight is not — how fast the surface turns away is a property of
   * the sphere, not of the screen. */
  const wantReach = Math.min(RIM.reachMaxPx, Math.max(RIM.reachMinPx, trueR * RIM.reachFrac));
  ok(
    Math.abs(trueR - rIn - wantReach) < 1.0,
    `d=${dist}: the inward reach scales with the limb radius, within its clamps`
  );
  /* The stop with the largest alpha IS the limb. Parsed out of the rgba
   * string, because that is what the browser will read. */
  const alphaOf = (c) => Number(c.slice(c.lastIndexOf(',') + 1, -1));
  const peak = base.stops.reduce((a, b) => (alphaOf(b[1]) > alphaOf(a[1]) ? b : a));
  const peakPx = rIn + peak[0] * (rOut - rIn);
  ok(
    Math.abs(peakPx - trueR) < 1.0,
    `d=${dist}: the brightest stop sits on the real limb (${peakPx.toFixed(1)} vs ${trueR.toFixed(1)} px)`
  );
}

/* 2 — IT ASKS MAPLIBRE, IT DOES NOT DERIVE. --------------------------------
 * The radius must come out of `isLocationOccluded`. If a later pass computes it
 * from the Three camera or from a closed form instead, the oracle stops being
 * called — and the answer silently moves by up to 70 px on a wide screen.
 * MUTATION: replace the `measure()` body with any arithmetic on the zoom and
 * this fails. Verified. */
stubMapCalls.n = 0;
paint(1);
ok(stubMapCalls.n > 0, 'the limb radius is measured by asking MapLibre what is occluded');

/* 3 — THE CAGE HANDOFF, ON THE CAGE'S OWN BAND. ----------------------------
 * The cage's opacity is `1 - smoothstep(p, ...DIVE.fade.cage)`. The rim must be
 * its exact complement, so the two always sum to one edge's worth of presence.
 * MUTATION: give the rim its own band constant and the mid-band figure stops
 * matching. Verified. */
{
  const [a, b] = DIVE.fade.cage;
  const at = (p) => Number(paint(p).style.opacity);
  ok(at(a) === 0, 'the rim is absent while the cage is at full strength');
  ok(at(0) === 0, 'and absent at the space floor');
  const mid = (a + b) / 2;
  ok(
    Math.abs(at(mid) - smoothstep(mid, a, b)) < 1e-6,
    'mid-dive the rim is exactly the cage fade complement — one band, two readings'
  );
  ok(at(1) > 0.99, 'and it is fully up once MapLibre owns the screen');
}

/* 3b — IT IS DRAWN AT ALL AFTER THE HANDOFF, WHICH IS THE WHOLE POINT.
 * Every other layer in map/globe3d.js is cleared at p >= 1. If this one is
 * skipped with them, the feature does not exist on the only screens that
 * needed it.
 * MUTATION: drop `limbRim?.update({ p: 1 })` from the early-out branch of
 * map/globe3d.js and this passes while the app does nothing — so it is asserted
 * against the SOURCE as well, below. */
{
  const cv = paint(1);
  ok(cv._fills.length === 2, 'a fully handed-off frame still paints both the ring and its lit arc');
}
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../map/globe3d.js', import.meta.url), 'utf8');
  const early = src.slice(src.indexOf('if (p >= 1)'), src.indexOf('const dist = followMap'));
  ok(
    /limbRim\?\.update/.test(early),
    'globe3d.js drives the rim from the p >= 1 branch too — that band IS the feature'
  );
}

/* 4 — THE LIT ARC FLIPS SIDES BETWEEN THE THEMES. --------------------------
 * The light sits up and to the left (RIM.lightAt, which mirrors the #spacebg
 * gradient in index.html). Dark puts the strong arc THERE; light puts it
 * opposite, because there is no headroom above a near-white sea and the read
 * has to come from shading instead.
 * MUTATION: drop the isLight() flip in map/limb-rim.js and the second pair
 * fails. Verified. */
{
  const lit = (cv) => cv._grads.find((g) => g.kind === 'linear');
  setThemeMode(MODE.DARK);
  const d = lit(paint(1));
  ok(d.x0 < window.innerWidth / 2 && d.y0 < window.innerHeight / 2,
    'dark: the strong arc starts up and left, where the backdrop says the light is');

  setThemeMode(MODE.LIGHT);
  const l = lit(paint(1));
  ok(l.x0 > window.innerWidth / 2 && l.y0 > window.innerHeight / 2,
    'light: the strong arc is on the far side — shading, not a highlight it cannot make');

  ok(
    Math.sign(d.x0 - window.innerWidth / 2) === -Math.sign(l.x0 - window.innerWidth / 2),
    'the two themes are opposite ends of the same axis, never the same end'
  );
}

/* 4b — BOTH THEMES PUBLISH A REAL STRENGTH, AND LIGHT IS THE HIGHER ONE.
 * The light theme sets `space` to `ocean` exactly, so the rim is the only thing
 * separating the sea from the page there. A zero in either is the layer
 * silently switched off for half the users. */
ok(DARK.fx.rim > 0 && LIGHT.fx.rim > 0, 'both themes actually run the rim');
ok(
  LIGHT.fx.rim >= DARK.fx.rim,
  'light is not the weaker of the two — there, the rim carries the entire edge'
);
ok(
  DARK.atmosphereDeep !== DARK.atmosphere && LIGHT.atmosphereDeep !== LIGHT.atmosphere,
  'the arc has a colour of its own in both palettes, or there is no arc'
);

/* 5 — IT GOES OUT WHEN THE HORIZON LEAVES THE SCREEN. ----------------------
 * With the globe centred the limb is entirely off screen past the viewport's
 * half-diagonal. Zooming in past that must switch the layer off rather than
 * keep filling an annulus nobody can see.
 * MUTATION: delete the offScreen fade and the last two fail. Verified. */
{
  setThemeMode(MODE.DARK);
  const halfDiag = Math.hypot(window.innerWidth / 2, window.innerHeight / 2);
  /* Find a camera distance whose limb radius clears the far end of the band.
   * Derived from the stub's own geometry, never typed. */
  let close = 3;
  for (let i = 0; i < 200 && stubMap(close).trueLimbPx() < halfDiag * RIM.offScreen[1] * 1.2; i++) {
    close = 1 + (close - 1) * 0.9;
  }
  const far = paint(1, 3);
  const near = paint(1, close);
  ok(Number(far.style.opacity) > 0, 'with the horizon on screen the rim is lit');
  ok(Number(near.style.opacity) === 0, 'zoomed past the horizon the rim goes out');
  ok(near._fills.length === 0, 'and it does not pay for the fill either');
}

/* 6 — A FLAT TRANSFORM HAS NO LIMB, AND THAT IS NOT A ZERO. ----------------
 * `limbRadiusPx` answers null on the mercator transform and on a frame the
 * projection refuses. A null quietly becoming 0 would be read downstream as
 * "a very small globe" and paint a ring in the middle of the screen.
 * MUTATION: return 0 instead of null on the no-limb path and this fails. */
{
  const cv = stubCanvas();
  const flat = stubMap(3);
  flat.transform.isLocationOccluded = () => false; // nothing is ever hidden
  const rim = createLimbRim(cv, flat);
  rim.update({ p: 1 });
  ok(cv._fills.length === 0, 'no limb to find means nothing is drawn');
  ok(Number(cv.style.opacity) === 0, 'and the layer reports itself as absent');
}

console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
