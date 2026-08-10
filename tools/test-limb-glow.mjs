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
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
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
  project() {
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
    fill() {
      fills.push({ stops: ctx._stops.slice(), composite });
    },
    arc(x, y, r) {
      ctx._last = { x, y, r };
    },
    createRadialGradient() {
      ctx._stops = [];
      return { addColorStop: (o, c) => ctx._stops.push([o, c]) };
    },
    set fillStyle(_v) {},
    _stops: [],
    _last: null,
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

/** A live storm head. `dir` z=+1 faces the camera, z=-1 is the far side. */
const head = (z, sev = 1, color = '#FF0000') => ({
  dir: new V3(0, 0, z),
  sev,
  color,
  head: true,
});

const { createLimbGlow } = await import('../map/limb-glow.js');
const { setThemeMode, MODE } = await import('../config/theme.js');
const { GLOW } = await import('../config/constants.js');
const { DARK, LIGHT } = await import('../config/tokens.js');
const { matchDistance, radiusPxAt } = await import('../map/globe-follow.js');

const paint = (pts, state = 'ok', p = 0) => {
  const cv = stubCanvas();
  const glow = createLimbGlow(cv, {
    getStormPoints: () => pts,
    getState: () => state,
  });
  glow.update({ group, camera, radiusPx: 120, p });
  return cv;
};

console.log('limb-glow');

/* 1 — BOTH BLEND MODES, BOTH THEMES. -------------------------------------- */
setThemeMode(MODE.DARK);
let cv = paint([head(1)]);
ok(cv.style.mixBlendMode === 'screen', 'dark: canvas blends onto the backdrop with screen');
ok(cv._fills[0]?.composite === 'lighter', 'dark: blobs blend with each other additively');

setThemeMode(MODE.LIGHT);
cv = paint([head(1)]);
ok(cv.style.mixBlendMode === 'multiply', 'light: canvas blends onto the backdrop with multiply');
ok(cv._fills[0]?.composite === 'multiply', 'light: blobs stack like coloured filters');

/* The pairing is the point — additive INSIDE a multiplied canvas is the black
 * smear this test exists to catch. Neither mode may share a value. */
ok(
  LIGHT.fx.glow < DARK.fx.glow,
  'light glow runs LOWER than dark — multiply is stronger than screen, not weaker'
);
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
  const glow = createLimbGlow(cv2, { getStormPoints: () => [head(1)], getState: () => 'ok' });
  setThemeMode(MODE.LIGHT);
  glow.retheme();
  glow.update({ group, camera, radiusPx: 120, p: 0 });
  ok(cv2.style.mixBlendMode === 'multiply', 'toggling to light re-blends the canvas as multiply');
  ok(
    cv2._fills.at(-1)?.composite === 'multiply',
    'toggling to light re-blends the BLOBS as multiply too'
  );
}

/* 2 — AN OUTAGE GOES DARK (SPEC §5). --------------------------------------- */
setThemeMode(MODE.DARK);
cv = paint([head(1)], 'unavailable');
ok(cv._fills.length === 0, 'feed unavailable: nothing is drawn');
ok(cv.style.opacity === '0', 'feed unavailable: the layer is fully transparent');

/* 3 — THE FAR SIDE STILL LIGHTS, AND MORE FAINTLY THAN THE NEAR SIDE. ------ */
const near = paint([head(1)]);
const far = paint([head(-1)]);
ok(far._fills.length === 1, 'a storm on the FAR side of the globe still throws light');

const alphaOf = (c) => {
  const m = /rgba\([^)]*,([0-9.]+)\)$/.exec(c._fills[0]?.stops?.[0]?.[1] ?? '');
  return m ? parseFloat(m[1]) : NaN;
};
ok(alphaOf(far) < alphaOf(near), 'far-side light is dimmer than near-side light');
ok(alphaOf(far) > 0, 'far-side light is dimmer but NOT extinguished');

/* 4 — PAST THE EYE PLANE IS REFUSED, NOT MIRRORED. ------------------------- */
const behind = { dir: new V3(0, 0, 4), sev: 1, color: '#FF0000', head: true };
ok(paint([behind])._fills.length === 0, 'a point behind the camera is dropped, not flipped');

/* 5 — ONE LIGHT PER STORM, AND ONLY LIVE ONES. ----------------------------- */
const trackPoint = { dir: new V3(0, 0, 1), sev: 1, color: '#FF0000', head: false };
ok(paint([trackPoint])._fills.length === 0, 'track points are not lights — only the live fix is');
ok(paint([head(1, 0)])._fills.length === 0, 'a zero-severity point throws no light');
ok(
  paint(Array.from({ length: GLOW.maxLights + 6 }, () => head(1)))._fills.length ===
    GLOW.maxLights,
  'the light count is capped at GLOW.maxLights'
);

/* 6 — THE DIVE PUTS IT OUT BEFORE MAPLIBRE OWNS THE SCREEN. ---------------- */
ok(paint([head(1)], 'ok', 1)._fills.length === 0, 'handed off to the flat map: no light');
ok(
  paint([head(1)], 'ok', GLOW.fade[1] + 0.01)._fills.length === 0,
  'past the fade band: no light'
);
ok(paint([head(1)], 'ok', 0)._fills.length === 1, 'at the space floor: lit');

/* 7 — CONSTANTS STAY IN THEIR LANES. --------------------------------------- */
ok(GLOW.fade[0] < GLOW.fade[1], 'the fade band runs forwards');
ok(GLOW.farGain > 0 && GLOW.farGain < GLOW.nearGain, 'far gain is dimmer than near, and non-zero');
ok(GLOW.radiusFloor > 0 && GLOW.radiusFloor < 1, 'radius floor is a fraction');
ok(GLOW.pixelScale > 0 && GLOW.pixelScale <= 1, 'the buffer is not larger than the viewport');
ok(GLOW.coreStop > 0 && GLOW.coreStop < 1, 'the mid stop sits inside the gradient');

/* 8 — radiusPxAt IS THE EXACT INVERSE OF matchDistance. --------------------
 * Two readings of one formula, in one file, free to drift the moment either
 * is touched. Round-trip every plausible on-screen radius. */
let worst = 0;
for (const r of [40, 120, 300, 800, 2400]) {
  const back = radiusPxAt(matchDistance(r));
  worst = Math.max(worst, Math.abs(back - r) / r);
}
ok(worst < 1e-9, `radiusPxAt round-trips matchDistance (worst relative error ${worst})`);

console.log(`  ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
