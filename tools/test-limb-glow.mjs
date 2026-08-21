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

/* ==> THE SCRATCH CANVAS IS PART OF THE THING UNDER TEST, SO THE STUB HAS TO
 * MAKE ONE. <==
 *
 * limb-glow composites each storm through its own offscreen buffer so a ridge
 * that crossed six categories cannot stack six blobs into a hot spot (see
 * `GLOW.intensity`). It asks `document.createElement('canvas')` for that
 * buffer, and there was no `document` here — so the module fell back to
 * painting straight onto the main canvas and the ENTIRE per-storm path went
 * untested while all 63 checks stayed green. That is the exact failure this
 * repo's rule about tests inheriting the bug's assumptions is about.
 *
 * The scratch shares the SAME `fills` array as the main canvas, so `_fills`
 * keeps meaning "every blob drawn this frame" wherever it landed, and the main
 * canvas records `drawImage` in `_blits` — which is where a storm's real
 * strength now lives, since the blobs themselves are normalised to the storm's
 * peak inside the buffer. */
function stubCanvas(fills = []) {
  const blits = [];
  let composite = null;
  let alpha = 1;
  const ctx = {
    set globalCompositeOperation(v) {
      composite = v;
    },
    get globalCompositeOperation() {
      return composite;
    },
    set globalAlpha(v) {
      alpha = v;
    },
    get globalAlpha() {
      return alpha;
    },
    drawImage() {
      blits.push({ alpha, composite });
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
    _blits: blits,
    _ctx: ctx,
  };
}

/* Set by `mount` just before the module builds its scratch buffer, so the two
 * canvases share one fills array. */
let _sharedFills = null;
let _lastScratch = null;
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`the stub document only makes canvases, not <${tag}>`);
    _lastScratch = stubCanvas(_sharedFills || []);
    return _lastScratch;
  },
};

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

/* ONE mount path for every helper below. `_sharedFills` has to be set BEFORE
 * createLimbGlow runs, because that is when it asks for its scratch buffer. */
const paint = (pts, state = 'ok', p = 0) => {
  const fills = [];
  _sharedFills = fills;
  _lastScratch = null;
  const cv = stubCanvas(fills);
  const glow = createLimbGlow(cv, {
    getStormPoints: () => pts,
    getState: () => state,
  });
  glow.update({ group, camera, radiusPx: R_PX, p });
  cv._scratch = _lastScratch;
  return cv;
};

console.log('limb-glow');

/* 1 — BOTH BLEND MODES, BOTH THEMES. -------------------------------------- */
setThemeMode(MODE.DARK);
let cv = paint([atAngleLit()]);
ok(cv.style.mixBlendMode === 'screen', 'dark: canvas blends onto the backdrop with screen');
/* ==> THE OPERATOR NOW SITS ON THE BLIT, NOT ON THE BLOB, AND THAT SPLIT IS
 * THE 2026-08-21 FIX. <== Dark still adds — two separate storms really are two
 * lights on a wall — but the thing being added is a whole STORM, composited in
 * its own buffer. Additive between a storm's own color runs is what made a
 * ridge that crossed six categories stack to near-white over exactly its
 * tallest point: "the light intensity is proportional to the height of the
 * mesh and I don't want it to be."
 * MUTATION: draw the blobs onto the main context instead of the scratch and
 * the second of these fails. Verified. */
ok(cv._blits[0]?.composite === 'lighter', 'dark: whole storms add to each other');
ok(
  cv._fills[0]?.composite === 'source-over',
  "dark: a storm's own color runs blend, never sum — severity must not brighten the light"
);

setThemeMode(MODE.LIGHT);
cv = paint([atAngleLit()]);
ok(
  cv.style.mixBlendMode === 'color',
  'light: the canvas TINTS the backdrop — `color` keeps its luminosity, `multiply` could only darken it'
);
ok(cv.style.mixBlendMode !== 'multiply', 'light never darkens the backdrop — that is the smudge');
/* ==> STORMS STACK WITH PLAIN ALPHA IN LIGHT, NOT `multiply`. <==
 * Multiply is per-channel arithmetic that does not know what a hue is: a
 * saturated Cat 1 yellow leaves red and green untouched and drives blue to
 * zero, so yellow could not be attenuated by anything else in the ramp and the
 * blues and greens were erased. It also manufactured hues no storm had —
 * yellow x TD blue reads green. Aaron on glass, 2026-08-18.
 *
 * The guard moved to the BLIT on 2026-08-21, because that is where two storms
 * now meet — a storm's own runs blend inside its scratch buffer before either
 * operator sees them. Both are pinned: an operator that invented hues would be
 * just as wrong applied within one storm as between two.
 * MUTATION: set either back to 'multiply' and this fails. Verified. */
ok(cv._blits[0]?.composite === 'source-over', 'light: storms stack with plain alpha, so no hue is invented');
ok(cv._blits[0]?.composite !== 'multiply', 'light never multiplies storms — that is what yellow could not lose to');
ok(cv._fills[0]?.composite === 'source-over', "light: and a storm's own runs blend the same way");

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
  const fills = [];
  _sharedFills = fills;
  const cv2 = stubCanvas(fills);
  const glow = createLimbGlow(cv2, { getStormPoints: () => [atAngleLit()], getState: () => 'ok' });
  setThemeMode(MODE.LIGHT);
  glow.retheme();
  glow.update({ group, camera, radiusPx: R_PX, p: 0 });
  ok(cv2.style.mixBlendMode === 'color', 'toggling to light re-blends the canvas as a tint');
  ok(
    cv2._blits.at(-1)?.composite === 'source-over',
    'toggling to light re-blends the STORMS to plain alpha too'
  );
  /* The scratch operator does not vary with the theme, so a live toggle is the
   * one place a `retheme` that forgot to restore it would show — every other
   * path gets a `resize` afterwards, which sets it again. */
  ok(
    cv2._fills.at(-1)?.composite === 'source-over',
    "and the scratch is still blending a storm's own runs, not summing them"
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
/* ==> A LIGHT'S REAL STRENGTH IS THE STOP ALPHA TIMES THE BLIT ALPHA. <==
 * Inside the scratch buffer a storm's blobs are normalised so its brightest run
 * is fully opaque — that is what stops runs stacking and it is also what gives
 * the falloff the full 8 bits to quantise into. The strength that actually
 * reaches the backdrop is carried by the `drawImage` that blits the storm. Read
 * only the stop and every storm looks identical; read only the blit and the
 * relative weighting between one storm's runs disappears. */
const alphaOf = (c, i = 0) => {
  const m = /rgba\([^)]*,([0-9.]+)\)$/.exec(c._fills[i]?.stops?.[0]?.[1] ?? '');
  if (!m) return NaN;
  return parseFloat(m[1]) * (c._blits[0]?.alpha ?? 1);
};

/** A storm at `deg` from the camera axis: 0 faces you, 180 is straight behind. */
const atAngle = (deg, sev = 1) => {
  const t = (deg * Math.PI) / 180;
  return { dir: new V3(Math.sin(t), 0, Math.cos(t)), sev, color: '#FF0000', head: true };
};

const paintAtColor = (deg, color) => {
  const t = (deg * Math.PI) / 180;
  return paint([{ dir: new V3(Math.sin(t), 0, Math.cos(t)), sev: 1, color, head: true }]);
};

const paintAt = (deg, sev = 1) => paint([atAngle(deg, sev)]);

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

/* ==> A STORM THAT WORE SIX COLORS IS NO BRIGHTER THAN ONE THAT WORE ONE. <==
 *
 * This is the 2026-08-21 bug, and it is the reason `intensity` is a ceiling per
 * STORM rather than per blob. One light per color run means a ridge that
 * climbed TD -> TS -> Cat 1 -> 2 -> 3 -> 4 spends six slots, and the six land
 * on top of each other because categories change fastest near a storm's peak.
 * Additively that summed to 0.96 alpha — a near-white hot spot over exactly the
 * tallest part of the cage — against 0.16 for a storm that stayed a depression.
 * No term multiplied by severity; the picture said it anyway. Aaron on glass:
 * "the light intensity is proportional to the height of the mesh and I don't
 * want it to be."
 *
 * MUTATION: draw the blobs onto the main context instead of compositing each
 * storm through the scratch, and `many` comes back six times `one`. Verified.
 * Softening the operator alone is NOT enough and this catches that too — plain
 * `source-over` on the main canvas still accumulates six runs to 0.65. */
{
  const t = (LIT_DEG * Math.PI) / 180;
  const dir = () => new V3(Math.sin(t), 0, Math.cos(t));
  /* Every §6 category, stacked on one spot: six runs of one storm. Real ridges
   * spread them along a track, but the peak is where they crowd and the peak is
   * what went white. */
  const ramp = ['#5BA8E0', '#3ECC7A', '#FFE14D', '#FFB52E', '#FF7A33', '#FF4D6D'];
  const climber = [{ dir: dir(), sev: 1, color: ramp[0], head: true }];
  for (const color of ramp) {
    for (let k = 0; k < 4; k++) climber.push({ dir: dir(), sev: 1, color, head: false });
  }
  const flat = [
    { dir: dir(), sev: 1, color: ramp[0], head: true },
    ...Array.from({ length: 4 }, () => ({ dir: dir(), sev: 1, color: ramp[0], head: false })),
  ];

  const many = paint(climber);
  const one = paint(flat);
  ok(many._fills.length === ramp.length, 'a storm that crossed six categories throws six lights');
  ok(one._fills.length === 1, 'and one that never changed throws one');

  /* The blit is the whole storm's strength on the backdrop. One blit per storm,
   * and the two storms are identically placed, so the numbers are comparable. */
  ok(many._blits.length === 1, 'six runs still composite as ONE storm');
  const manyA = many._blits[0]?.alpha ?? 0;
  const oneA = one._blits[0]?.alpha ?? 0;
  /* Both sides must be REAL strengths before they are compared. Without this
   * the check passes when nothing was blitted at all — 0 === 0 — which is
   * exactly what happened under the first mutation run. */
  ok(manyA > 0 && oneA > 0, 'both storms actually reach the backdrop');
  ok(
    Math.abs(manyA - oneA) < 1e-9,
    'and the six-color storm reaches the backdrop no brighter than the one-color storm'
  );

  /* The relative weighting BETWEEN a storm's own runs still has to survive —
   * flattening every run to the storm's peak would trade one wrong picture for
   * another. All six sit at the same aim here, so all six normalise to 1. */
  const stops = many._fills.map((f) => parseFloat(/,([0-9.]+)\)$/.exec(f.stops[0][1])[1]));
  ok(stops.every((s) => s > 0 && s <= 1), 'each run keeps its own share of the storm inside the buffer');

  /* Two SEPARATE storms are a different claim and must still add up: that is a
   * true statement about how many systems are out there, not a restatement of
   * one storm's severity.
   * MUTATION: composite all storms through one buffer and this fails. */
  const at = (deg) => new V3(Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180));
  const two = paint([
    { dir: at(LIT_DEG), sev: 1, color: ramp[0], head: true },
    { dir: at(LIT_DEG + 12), sev: 1, color: ramp[5], head: true },
  ]);
  ok(two._blits.length === 2, 'two storms composite separately, so they can still stack');
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

/* ==> THE FALLOFF IS FLAT-TOPPED, NOT PEAKED, AND THAT IS WHAT STOPS IT
 * READING AS A LAMP. <==
 *
 * A bright centre that fades outward is the visual signature of a SOURCE, and
 * because a blob lands straight outward from its storm along the same line the
 * ridge lifts, that hot spot sat directly over the peak. Aaron on glass,
 * 2026-08-21: "it looks like there is a floating light source above the raised
 * mesh... I only want to see the light reflected onto the background. I don't
 * want to see a source."
 *
 * The shape is pinned here rather than the numbers: the inner stop has to hold
 * nearly all the alpha, so there is no centre to find, and the outer stop has
 * to be well down, so the tail does not read as a disc with a soft edge.
 * MUTATION: restore the old single mid stop (0.32 at 0.62) and the plateau
 * checks fail. Verified. */
ok(GLOW.plateauStop > 0 && GLOW.plateauStop < GLOW.coreStop, 'the plateau ends before the shoulder');
ok(GLOW.coreStop > GLOW.plateauStop && GLOW.coreStop < 1, 'the shoulder sits inside the gradient');
ok(
  GLOW.plateauAlpha >= 0.9,
  'the plateau is FLAT — a light that peaks at its centre is a light source, which is the thing being removed'
);
ok(GLOW.coreAlpha < GLOW.plateauAlpha, 'and the shoulder is genuinely down from it, or there is no falloff');
{
  /* Read off a real paint, not off the constants: a stop table that is never
   * emitted in that order is a rule the picture does not obey. */
  const stops = paintAt(LIT_DEG)._fills[0].stops;
  const alphas = stops.map((s) => parseFloat(/,([0-9.]+)\)$/.exec(s[1])[1]));
  ok(stops.length === 4, 'four stops are emitted: centre, plateau, shoulder, rim');
  ok(
    alphas[1] / alphas[0] >= 0.9,
    'the painted gradient is still level across the plateau, not just the constant'
  );
  ok(alphas.at(-1) === 0, 'and reaches zero at the rim, the identity for both `lighter` and `color`');
}
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

/* ==> THE BLUR ON `#glow` IS LOAD-BEARING AND NOTHING ELSE WOULD MISS IT. <==
 *
 * It is the only thing that removes the weave. An 8-bit alpha channel holds
 * about `intensity * 255` distinct values, so the falloff contours into bands
 * INSIDE the small buffer and bilinear magnification stretches every band edge
 * into a facet along the texel grid — a fine crosshatch on an image whose whole
 * job is to be smooth. Aaron on glass, 2026-08-21: "there's a weird grid/weave
 * pattern in the reflection, it's not smooth. It is not my monitor." He was
 * right; it is not the monitor and it is not the camera.
 *
 * Raising `pixelScale` does NOT fix it — the band count comes from alpha depth,
 * not pixel count, so a bigger buffer only makes the weave finer. The blur has
 * to act AFTER the magnification, which means CSS, which means no unit test can
 * see the pixels. So the wiring is checked at the source instead, which cannot
 * go quiet: a token that exists, and a rule that uses it.
 * MUTATION: delete either line from index.html and this fails. Verified. */
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ok(/--glow-blur:\s*[0-9.]+vmin;/.test(html),
     'index.html publishes --glow-blur, in vmin so it is the same fraction of the picture everywhere');
  const rule = /#glow\s*\{[^}]*\}/.exec(html)?.[0] ?? '';
  ok(/filter:\s*blur\(var\(--glow-blur\)\)/.test(rule),
     '#glow really applies it — without the blur the falloff contours and the weave comes back');
  /* The blur is what pays for a smaller buffer, so the two move together. If
   * `pixelScale` is ever pushed back up as a "fix" for the weave, that is the
   * wrong lever and this comment is the note explaining why. */
  ok(GLOW.pixelScale <= 0.25, 'the buffer stays small — the blur carries the smoothing, not the resolution');
}
setThemeMode(MODE.DARK);

console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
