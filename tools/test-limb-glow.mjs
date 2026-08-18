/**
 * test-limb-glow.mjs — the backdrop storm light (map/limb-glow.js).
 *
 * WHY THIS FILE EXISTS. Every failure this layer can have is SILENT. It draws
 * onto its own canvas underneath the map, it never throws, and it has no
 * assertion of its own — a wrong blend mode, a dropped far-side storm, or a
 * light left burning through a feed outage all render as "hmm, that looks a
 * bit off" on a phone, weeks later, with no error anywhere.
 *
 * Four of those are safety- or intent-critical and are pinned here:
 *
 *   1. BOTH BLEND MODES FLIP TOGETHER. There are two — one between blobs
 *      inside the canvas, one between the canvas and the CSS gradient — and
 *      they are set in two different places. Changing one and not the other
 *      gives additive light multiplied into a pale sky, which is a black
 *      smear. Nothing else in the app would notice.
 *   2. AN OUTAGE GOES DARK. The cage already greys out when the feed is
 *      unavailable (SPEC §5); a globe that knows nothing must not be throwing
 *      a cheerful light show. This is the one assertion here that is about
 *      safety rather than looks.
 *   3. THE FAR SIDE STILL LIGHTS. It is the whole reason this was built rather
 *      than a rim/Fresnel effect, and it is exactly the behaviour a later
 *      "optimisation" would delete as an obvious win.
 *   4. A STORM BEHIND THE EYE IS REFUSED, NOT MIRRORED. Past the eye plane the
 *      perspective divide flips sign, so an unguarded projection puts the
 *      storm on the OPPOSITE side of the screen at full brightness.
 *
 * Plus the arithmetic identity that `radiusPxAt` is the exact inverse of
 * `matchDistance` — two readings of one formula that are free to drift apart.
 *
 * NO DOM AND NO WEBGL. The canvas, its 2D context and the handful of THREE
 * classes this file touches are stubbed below, and the stub RECORDS rather
 * than draws. `THREE` is read at module scope in the file under test, so the
 * import is dynamic and happens after the globals are in place.
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

/* --- the stub world -------------------------------------------------------
 * Matrices are TRANSLATION ONLY, which is all this file's maths needs and is
 * enough to make the near/far split and the eye-plane guard behave like the
 * real thing. `project` is a plain perspective divide — deterministic and
 * monotonic, which is everything the assertions below lean on. */
class M4 {
  constructor(x = 0, y = 0, z = 0) {
    this.t = [x, y, z];
  }
  copy(m) {
    this.t = m.t.slice();
    return this;
  }
  invert() {
    this.t = this.t.map((v) => -v);
    return this;
  }
}
class V3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  multiplyScalar(k) {
    this.x *= k;
    this.y *= k;
    this.z *= k;
    return this;
  }
  applyMatrix4(m) {
    this.x += m.t[0];
    this.y += m.t[1];
    this.z += m.t[2];
    return this;
  }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= l;
    this.y /= l;
    this.z /= l;
    return this;
  }
  /* A real perspective projection has to go through the camera before the
   * divide. Dividing by the WORLD z instead silently produces a plausible
   * number for every point, which is exactly the kind of stub bug that lets a
   * geometry test pass on the same mistake as the code it is testing. */
  project(cam) {
    this.applyMatrix4(cam.matrixWorldInverse);
    const d = -this.z || 1e-6;
    this.x = this.x / d;
    this.y = this.y / d;
    return this;
  }
}
globalThis.THREE = { Vector3: V3, Matrix4: M4 };
globalThis.window = { innerWidth: 400, innerHeight: 800 };

function stubCanvas() {
  const fills = [];
  let composite = null;
  const ctx = {
    set globalCompositeOperation(v) {
      composite = v;
    },
    get globalCompositeOperation() {
      return composite;
    },
    clearRect() {},
    beginPath() {},
    save() {},
    restore() {},
    /* The light is drawn at the ORIGIN of a translated, rotated, scaled space
     * so one radial gradient can render as an ellipse. Recording the transform
     * is the only way a test can still see where the light landed and how it
     * was stretched — reading arc()'s coordinates alone would report 0,0 for
     * every light on screen. */
    translate(x, y) {
      ctx._xf = { x, y, rot: 0, sx: 1, sy: 1 };
    },
    rotate(t) {
      ctx._xf.rot = t;
    },
    scale(x, y) {
      ctx._xf.sx = x;
      ctx._xf.sy = y;
    },
    fill() {
      fills.push({ stops: ctx._stops.slice(), composite, xf: { ...ctx._xf }, r: ctx._r });
    },
    arc(x, y, r) {
      ctx._r = r;
      ctx._last = { x, y, r };
    },
    createRadialGradient() {
      ctx._stops = [];
      return { addColorStop: (o, c) => ctx._stops.push([o, c]) };
    },
    set fillStyle(_v) {},
    _stops: [],
    _last: null,
    _xf: { x: 0, y: 0, rot: 0, sx: 1, sy: 1 },
    _r: 0,
  };
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    _fills: fills,
    _ctx: ctx,
  };
}

const camera = { position: new V3(0, 0, 3), matrixWorldInverse: new M4(0, 0, -3) };
const group = { matrixWorld: new M4(0, 0, 0) };

/** A live storm head sitting in the LIT BAND — rotated past the limb, aimed at
 *  the backdrop. Every section other than the geometry one below just needs a
 *  storm that lights something, and this is the canonical one. */
const LIT_DEG = 120;
const atAngleLit = (sev = 1) => {
  const t = (LIT_DEG * Math.PI) / 180;
  return { dir: new V3(Math.sin(t), 0, Math.cos(t)), sev, color: '#FF0000', head: true };
};

const { readFileSync } = await import('node:fs');
const { createLimbGlow } = await import('../map/limb-glow.js');
const { setThemeMode, MODE } = await import('../config/theme.js');
const { GLOW } = await import('../config/constants.js');
const { DARK, LIGHT } = await import('../config/tokens.js');
const { matchDistance, radiusPxAt } = await import('../map/globe-follow.js');

/* The stub's projection is a bare perspective divide, so the globe's on-screen
 * radius has to be DERIVED from it rather than invented — a unit sphere at
 * distance 3 projects its silhouette at the tangent, 1/sqrt(8) in NDC. Passing
 * an arbitrary number here would make the occlusion test meaningless. */
const R_PX = (1 / Math.sqrt(8)) * 0.5 * window.innerWidth;

const paint = (pts, state = 'ok', p = 0) => {
  const cv = stubCanvas();
  const glow = createLimbGlow(cv, {
    getStormPoints: () => pts,
    getState: () => state,
  });
  glow.update({ group, camera, radiusPx: R_PX, p });
  return cv;
};

console.log('limb-glow');

/* 1 — BOTH BLEND MODES, BOTH THEMES. -------------------------------------- */
setThemeMode(MODE.DARK);
let cv = paint([atAngleLit()]);
ok(cv.style.mixBlendMode === 'screen', 'dark: canvas blends onto the backdrop with screen');
ok(cv._fills[0]?.composite === 'lighter', 'dark: blobs blend with each other additively');

setThemeMode(MODE.LIGHT);
cv = paint([atAngleLit()]);
ok(
  cv.style.mixBlendMode === 'color',
  'light: the canvas TINTS the backdrop — `color` keeps its luminosity, `multiply` could only darken it'
);
ok(cv.style.mixBlendMode !== 'multiply', 'light never darkens the backdrop — that is the smudge');
/* ==> BLOBS STACK WITH PLAIN ALPHA IN LIGHT, NOT `multiply`. <==
 * Multiply is per-channel arithmetic that does not know what a hue is: a
 * saturated Cat 1 yellow leaves red and green untouched and drives blue to
 * zero, so yellow could not be attenuated by anything else in the ramp and the
 * blues and greens were erased. It also manufactured hues no storm had —
 * yellow x TD blue reads green. Aaron on glass, 2026-08-18.
 * MUTATION: set it back to 'multiply' and this fails. Verified. */
ok(cv._fills[0]?.composite === 'source-over', 'light: blobs stack with plain alpha, so no hue is invented');
ok(cv._fills[0]?.composite !== 'multiply', 'light never multiplies blobs — that is what yellow could not lose to');

/* The pairing is the point — additive INSIDE a tinting canvas is the black
 * smear this test exists to catch. The two themes never share an operator. */
/* The two themes are free to sit anywhere relative to each other: they drive
 * different OPERATORS, so their numbers are not comparable. Both must simply
 * be a real strength — a zero here is the effect silently switched off for one
 * theme, which is the failure a stale relative assertion once hid. */
ok(DARK.fx.glow > 0 && LIGHT.fx.glow > 0, 'both themes actually run the light');
ok(
  typeof DARK.fx.glow === 'number' && typeof LIGHT.fx.glow === 'number',
  'both palettes publish fx.glow'
);

/* 1b — THE LIVE TOGGLE, WHICH IS A DIFFERENT PATH FROM BOOT AND THE ONLY ONE
 * THAT CATCHES A BROKEN `retheme`. Constructing fresh in each theme passes
 * even when retheme is wrong, because `resize` runs after it during setup and
 * restores the correct mode. A user flipping the theme gets no resize. This
 * builds in dark, switches, and re-paints without rebuilding — exactly what
 * map/globe3d.js's retheme() does. */
setThemeMode(MODE.DARK);
{
  const cv2 = stubCanvas();
  const glow = createLimbGlow(cv2, { getStormPoints: () => [atAngleLit()], getState: () => 'ok' });
  setThemeMode(MODE.LIGHT);
  glow.retheme();
  glow.update({ group, camera, radiusPx: R_PX, p: 0 });
  ok(cv2.style.mixBlendMode === 'color', 'toggling to light re-blends the canvas as a tint');
  ok(
    cv2._fills.at(-1)?.composite === 'source-over',
    'toggling to light re-blends the BLOBS to plain alpha too'
  );
}

/* 2 — AN OUTAGE GOES DARK (SPEC §5). --------------------------------------- */
setThemeMode(MODE.DARK);
cv = paint([atAngleLit()], 'unavailable');
ok(cv._fills.length === 0, 'feed unavailable: nothing is drawn');
ok(cv.style.opacity === '0', 'feed unavailable: the layer is fully transparent');

/* 3 — THE GEOMETRY: A LAMP ONLY LIGHTS THE WALL IT IS AIMED AT. ------------
 *
 * This is the section that exists because the FIRST cut of this file was
 * geometrically wrong in a way every check still passed. It drew each light at
 * the storm's own screen position — a halo around a lamp — and on glass it read
 * as the mesh glowing rather than as the backdrop being lit. Nothing asserted
 * WHERE the light landed, so nothing caught it.
 *
 * A storm is a lamp on the globe's skin aiming straight out. Three consequences,
 * all pinned here, none of which the old placement had:
 *
 *   facing the camera   -> lights NOTHING. The beam goes between you and the
 *                          globe, and there is no surface there.
 *   straight behind     -> lands directly behind the planet, which hides it.
 *   just past the limb  -> lands outside the disc, aimed properly at the wall.
 *                          This band IS the effect. */
const alphaOf = (c) => {
  const m = /rgba\([^)]*,([0-9.]+)\)$/.exec(c._fills[0]?.stops?.[0]?.[1] ?? '');
  return m ? parseFloat(m[1]) : NaN;
};

/** A storm at `deg` from the camera axis: 0 faces you, 180 is straight behind. */
const atAngle = (deg, sev = 1) => {
  const t = (deg * Math.PI) / 180;
  return { dir: new V3(Math.sin(t), 0, Math.cos(t)), sev, color: '#FF0000', head: true };
};

const paintAtColor = (deg, color) => {
  const t = (deg * Math.PI) / 180;
  const pt = { dir: new V3(Math.sin(t), 0, Math.cos(t)), sev: 1, color, head: true };
  const cv = stubCanvas();
  const glow = createLimbGlow(cv, { getStormPoints: () => [pt], getState: () => 'ok' });
  glow.update({ group, camera, radiusPx: R_PX, p: 0 });
  return cv;
};

const paintAt = (deg, sev = 1) => {
  const cv = stubCanvas();
  const glow = createLimbGlow(cv, { getStormPoints: () => [atAngle(deg, sev)], getState: () => 'ok' });
  glow.update({ group, camera, radiusPx: R_PX, p: 0 });
  return cv;
};

/* ==> NO LIVE STORM GOES DARK, ANYWHERE ON THE PLANET. <==
 *
 * These four used to assert the OPPOSITE — that a near-side storm and a storm
 * straight behind the globe both lit nothing. That was the shipped behaviour
 * and it was the bug: a Cat 4 in plain view on the front of the globe threw no
 * light while a weaker storm at the edge glowed, and a glow vanished off a
 * cliff as its storm rotated behind rather than fading. Aaron, 2026-08-18.
 *
 * MUTATION: put back either `if (away <= 0) continue` or `if (d <= rInner)
 * continue` in map/limb-glow.js and the matching pair below fails. Verified. */
ok(paintAt(0)._fills.length === 1, 'a storm facing the camera still lights the sky');
ok(paintAt(45)._fills.length === 1, 'and so does one on the near side');
ok(paintAt(180)._fills.length === 1, 'a storm aimed straight back spills light round the rim');
ok(paintAt(160)._fills.length === 1, 'deep behind the globe: still lit');

const band = paintAt(120);
ok(band._fills.length === 1, 'just past the limb: the wall is lit — this band IS the effect');
ok(alphaOf(band) > 0.1, 'and lit strongly enough to see, not a trace');

/* ==> THE LIMB IS STILL THE HERO. <== Everything lights now, so the thing that
 * has to be pinned is the ORDER: a grazing beam past the limb beats a
 * head-on one on the near side, and beats one buried behind the planet. Lose
 * that and the effect flattens into an even halo round the globe, which is the
 * failure mode of setting frontGain or rimFloor to 1.
 *
 * MUTATION: GLOW.frontGain = 1 fails the first; GLOW.rimFloor = 1 fails the
 * second. Verified. */
ok(alphaOf(paintAt(45)) < alphaOf(band), 'a near-side storm is dimmer than one at the limb');
ok(alphaOf(paintAt(180)) < alphaOf(band), 'and so is one hidden behind the planet');

/* A near-side light meets the shell head-on, so it is a round pool. The smear
 * is a fact about a GRAZING beam and must not leak onto storms that have not
 * rotated past the limb yet.
 * MUTATION: drive stretch/squash off `aim` instead of `behind` and this fails. */
{
  const xf = paintAt(45)._fills[0]?.xf;
  ok(xf?.sx === 1 && xf?.sy === 1, 'a near-side light is a round pool, not a smear');
}

/* The peak sits INSIDE the band rather than at either end of it — the product
 * of an aim that grows with rotation and a clearance that shrinks with it. */
const sweep = [95, 105, 115, 125, 135, 145].map((d) => alphaOf(paintAt(d)) || 0);
const peak = sweep.indexOf(Math.max(...sweep));
ok(peak > 0 && peak < sweep.length - 1, 'the light peaks mid-sweep, not at the limb or deep behind');
ok(sweep[0] < sweep[peak] && sweep[sweep.length - 1] < sweep[peak], 'it swells and then dies');

/* The landing point is OUTSIDE the globe's disc — the whole point. Anything
 * inside it is painting on the planet, not on the background. */
{
  const cv = paintAt(120);
  const cxs = 0.5 * cv.width;
  const cys = 0.5 * cv.height;
  const xf = cv._fills[0].xf;
  const d = Math.hypot(xf.x - cxs, xf.y - cys);
  ok(d > R_PX * (cv.width / window.innerWidth), 'the light lands OUTSIDE the globe silhouette');
}

/* 3c — THE SMEAR RUNS ALONG THE RIM, AND GROWS WITH THE SWEEP. -------------
 *
 * Light on a curved wall stretches along the curve. Two things can go wrong
 * silently and both are pinned: the ellipse could be round (no smear at all,
 * which is just the previous behaviour with dead constants), or it could be
 * stretched RADIALLY, which reads as a beam aimed at the viewer — the one
 * thing this geometry says cannot be happening. */
{
  const xfAt = (deg) => paintAt(deg)._fills[0].xf;
  const near = xfAt(100);
  const deep = xfAt(125);

  ok(deep.sx > deep.sy, 'the light is an ellipse, not a disc');
  ok(deep.sx > near.sx, 'it stretches further the deeper past the limb a storm has rotated');
  ok(deep.sy < near.sy, 'and thins across the curve as it does, so it cannot bloom');
  ok(near.sx > 1 && near.sy < 1, 'even near the limb it is already slightly drawn out');

  /* The major axis is the rotated x-axis, so the rotation must be a quarter
   * turn off the radial direction — that is what puts the light ALONG the rim
   * rather than pointing out through it. */
  const cv = paintAt(125);
  const rad = Math.atan2(
    cv._fills[0].xf.y - 0.5 * cv.height,
    cv._fills[0].xf.x - 0.5 * cv.width
  );
  const delta = Math.abs(((cv._fills[0].xf.rot - rad) % Math.PI) - Math.PI / 2);
  ok(delta < 1e-9, 'the smear is TANGENTIAL — perpendicular to the line from the globe centre');
}

/* 3b — THE LIGHT-THEME COLOR IS SATURATED, NOT DARKENED. -----------------
 *
 * The smudge shipped because the source color was scaled DOWN to give a
 * multiply filter something to subtract. Under `color` blending the source's
 * value is discarded entirely, so the only thing that matters is that hue
 * survives and chroma goes up. Pinned on a pale category green, which is the
 * exact case that was invisible at full alpha before. */
{
  const rgbFrom = (c) => c._fills[0].stops[0][1].match(/rgba\(([^)]+),[0-9.]+\)/)[1]
    .split(',').map(Number);

  setThemeMode(MODE.LIGHT);
  const litG = rgbFrom(paintAtColor(LIT_DEG, '#7FD98C'));
  setThemeMode(MODE.DARK);
  const darkG = rgbFrom(paintAtColor(LIT_DEG, '#7FD98C'));

  ok(darkG.join(',') === '127,217,140', 'dark uses the category color verbatim');

  const chroma = (c) => Math.max(...c) - Math.min(...c);
  ok(chroma(litG) > chroma(darkG), 'light pushes the pale category color to real chroma');
  ok(
    Math.max(...litG) >= Math.max(...darkG),
    'and never scales the color DOWN — darkening is what made it a smudge'
  );
  ok(
    litG[1] === Math.max(...litG) && litG.indexOf(Math.min(...litG)) === darkG.indexOf(Math.min(...darkG)),
    'hue survives: a green storm still throws green'
  );
  setThemeMode(MODE.DARK);
}

/* 4 — PAST THE EYE PLANE IS REFUSED, NOT MIRRORED. ------------------------- */
ok(
  paint([{ dir: new V3(0, 0, 9), sev: 1, color: '#FF0000', head: true }])._fills.length === 0,
  'a point past the eye plane is dropped, not mirrored to the far side of the screen'
);

/* 5 — ONE LIGHT PER RUN OF ONE COLOR, NOT ONE PER STORM. -------------------
 *
 * ==> THIS SECTION USED TO ASSERT THE OPPOSITE AND THE OPPOSITE WAS THE BUG.
 * <== "Track points are not lights — only the live fix is" was the shipped
 * rule, and it meant everything the cage REMEMBERS threw no light: a storm
 * that peaked at Cat 4 and has weakened to a Cat 1 drew a large red ridge on
 * the globe and a purely yellow glow behind it. The red was not dim, it was
 * never drawn. Aaron on glass, 2026-08-18.
 *
 * A bead is still not a light on its own — a bare track point with no storm
 * ahead of it belongs to nothing and is ignored — but a storm's beads are now
 * where its lights come from. */
const trackPoint = { ...atAngleLit(), head: false };
ok(paint([trackPoint])._fills.length === 0, 'a bead with no storm ahead of it belongs to nothing');
ok(paint([atAngleLit(0)])._fills.length === 0, 'a zero-severity point throws no light');
ok(
  paint([{ ...atAngleLit(), color: '#9AA0A5' }])._fills.length === 0,
  'a grey head throws nothing — no reading is no claim, so the sky says nothing'
);

/* A storm whose ridge crosses three categories throws THREE lights, one per
 * color, each at its own stretch of the track — not one light wearing the
 * head's color.
 * MUTATION: restore `if (pt.head !== true) continue` and this drops to 1. */
{
  const bead = (deg, color) => {
    const t = (deg * Math.PI) / 180;
    return { dir: new V3(Math.sin(t), 0, Math.cos(t)), sev: 0.5, color, head: false };
  };
  const storm = [
    { ...atAngle(120), color: '#FFE14D' },        // head: a Cat 1 now
    bead(112, '#FF4D6D'), bead(114, '#FF4D6D'),   // it was a Cat 4 back here
    bead(118, '#FFB52E'), bead(120, '#FFB52E'),
    bead(126, '#FFE14D'), bead(128, '#FFE14D'),
  ];
  const cv = paint(storm);
  const colorsOf = (c) => c._fills.map((f) => f.stops[0][1].match(/rgba\(([^)]+),/)[1]);
  ok(cv._fills.length === 3, 'a ridge crossing three categories throws three lights');
  ok(
    colorsOf(cv).includes('255,77,109'),
    'including the Cat 4 RED the storm no longer is — the mesh wears it, so the sky shows it'
  );

  /* Each light sits at its OWN run, so the three land in three places.
   * MUTATION: place every run at the head's dir and this fails. */
  const xs = cv._fills.map((f) => Math.round(f.xf.x));
  ok(new Set(xs).size === 3, 'the three lights land in three different places');

  /* The head's own light is dropped when beads exist, or the present position
   * is lit twice. Three runs, three fills — pinned by the count above. */
}

/* ==> BRIGHTNESS IS FLAT ACROSS SEVERITY; SIZE IS NOT FLAT ACROSS RUN LENGTH.
 * <== Aaron's rule: "one color shouldn't overpower the others unless there is
 * just more of it — height shouldn't dictate intensity."
 * MUTATION: multiply `a` by pt.sev again and the first fails; drive the radius
 * off severity instead of weight and the second fails. Both verified. */
{
  const weak = paintAt(LIT_DEG, 0.08);
  const strong = paintAt(LIT_DEG, 1);
  ok(alphaOf(weak) === alphaOf(strong), 'a depression shines exactly as bright as a Cat 5');

  const runOf = (n) => {
    const t = (LIT_DEG * Math.PI) / 180;
    const head = { dir: new V3(Math.sin(t), 0, Math.cos(t)), sev: 1, color: '#FF0000', head: true };
    const beads = Array.from({ length: n }, () => ({
      dir: new V3(Math.sin(t), 0, Math.cos(t)), sev: 1, color: '#FF0000', head: false,
    }));
    return paint([head, ...beads])._fills[0].r;
  };
  ok(runOf(GLOW.runFull) > runOf(1), 'a long run of one color throws a bigger light than a brief one');
  ok(runOf(GLOW.runFull * 3) === runOf(GLOW.runFull), 'and stops growing at runFull, so length cannot swamp');
}

ok(
  paint(Array.from({ length: GLOW.maxLights + 6 }, () => atAngleLit()))._fills.length ===
    GLOW.maxLights,
  'the light count is capped at GLOW.maxLights'
);

/* Over budget, every storm keeps its biggest run before any storm keeps its
 * second — a long-lived system's five color spans must not silence a smaller
 * storm outright, which would be a false count of live systems.
 * MUTATION: sort the whole list by weight and truncate; this fails. */
{
  const t = (LIT_DEG * Math.PI) / 180;
  const at = (deg) => new V3(Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180));
  const hog = [{ dir: at(120), sev: 1, color: '#FF0000', head: true }];
  for (let c = 0; c < GLOW.maxLights + 4; c++) {
    const col = `#${(0x110000 * (c + 1)).toString(16).padStart(6, '0')}`;
    for (let k = 0; k < 12; k++) hog.push({ dir: at(120), sev: 1, color: col, head: false });
  }
  const small = { dir: at(125), sev: 0.2, color: '#3ECC7A', head: true };
  const cv = paint([...hog, small]);
  const greens = cv._fills.filter((f) => /62,204,122/.test(f.stops[0][1]));
  ok(greens.length === 1, 'a small storm keeps its light however many runs a big one has');
  void t;
}

/* 6 — THE DIVE PUTS IT OUT BEFORE MAPLIBRE OWNS THE SCREEN. ---------------- */
ok(paint([atAngleLit()], 'ok', 1)._fills.length === 0, 'handed off to the flat map: no light');
ok(
  paint([atAngleLit()], 'ok', GLOW.fade[1] + 0.01)._fills.length === 0,
  'past the fade band: no light'
);
ok(paint([atAngleLit()], 'ok', 0)._fills.length === 1, 'at the space floor: lit');

/* 7 — CONSTANTS STAY IN THEIR LANES. --------------------------------------- */
ok(GLOW.fade[0] < GLOW.fade[1], 'the fade band runs forwards');
ok(GLOW.rimInner < GLOW.rimOuter, 'the rim fade runs outward');
ok(
  GLOW.wallRadius > GLOW.rimOuter,
  'the wall sits outside the rim fade — closer and this collapses into a glow ON the globe'
);
ok(
  LIGHT.fx.glowSaturate > 0 && DARK.fx.glowSaturate === 0,
  'light pushes chroma (its value is discarded by `color`); dark keeps the true category color'
);
ok(GLOW.radiusFloor > 0 && GLOW.radiusFloor < 1, 'radius floor is a fraction');
ok(GLOW.pixelScale > 0 && GLOW.pixelScale <= 1, 'the buffer is not larger than the viewport');
ok(GLOW.coreStop > 0 && GLOW.coreStop < 1, 'the mid stop sits inside the gradient');
ok(GLOW.smear > 0, 'the smear is live, not a dead constant');
ok(GLOW.squash > 0 && GLOW.squash < 1, 'the radial squash thins the light without inverting it');

/* 8 — radiusPxAt IS THE EXACT INVERSE OF matchDistance. --------------------
 * Two readings of one formula, in one file, free to drift the moment either
 * is touched. Round-trip every plausible on-screen radius. */
let worst = 0;
for (const r of [40, 120, 300, 800, 2400]) {
  const back = radiusPxAt(matchDistance(r));
  worst = Math.max(worst, Math.abs(back - r) / r);
}
ok(worst < 1e-9, `radiusPxAt round-trips matchDistance (worst relative error ${worst})`);

/* 9 — THE PER-THEME GAIN AND SPREAD ARE ACTUALLY WIRED IN. -----------------
 *
 * These two multipliers existed so light mode could run the effect HARDER than
 * dark, back when a single light per storm had to carry the whole thing against
 * a pale sky. A light per color run covers the sky several times over, so both
 * are 1.0 in both palettes as of 2026-08-18 and the effect is now the same
 * numbers through two different OPERATORS, which is what it was always meant to
 * be.
 *
 * ==> THAT MAKES THE OLD RATIO CHECK VACUOUS, AND A VACUOUS CHECK IS WORSE THAN
 * NONE. <== It compared the light blob's radius and alpha against dark's and
 * asserted the ratio equalled the dial. With every dial at 1 that is 1 === 1,
 * which passes just as happily if map/limb-glow.js stops reading the dials
 * altogether — the exact failure the section was written to catch. So the
 * ratios are asserted where they still mean something (dark, the reference) and
 * the wiring is checked at the source, which cannot go quiet.
 * MUTATION: drop `* spread` or `* gain` from the maths and this fails. */
ok(DARK.fx.glowGain === 1 && DARK.fx.glowSpread === 1,
   'dark is the untouched reference — both multipliers are exactly 1');
ok(LIGHT.fx.glowGain > 0 && LIGHT.fx.glowSpread > 0,
   'light publishes both multipliers as real numbers');
ok(GLOW.radiusScale * LIGHT.fx.glowSpread <= 1.4,
   'the light blob stays inside the "coming FROM the globe" limit (~1.4 effective)');

{
  const src = readFileSync(new URL('../map/limb-glow.js', import.meta.url), 'utf8');
  ok(/const spread = F\.glowSpread;/.test(src) && /\*\s*spread\b/.test(src),
     'the radius really is multiplied by the theme\'s glowSpread');
  ok(/const gain = F\.glowGain;/.test(src) && /\*\s*gain\b/.test(src),
     'the alpha really is multiplied by the theme\'s glowGain');
}
setThemeMode(MODE.DARK);

console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
