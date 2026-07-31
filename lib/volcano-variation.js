/**
 * volcano-variation.js — NO TWO VOLCANOES ARE THE SAME MOUNTAIN.
 *
 * ==> WHY THIS FILE EXISTS. <== Before it, every cone in the drawn set was
 * geometrically the SAME OBJECT. Measured at ec8cf97: Fujisan, Etna, Rainier,
 * Popocatépetl and Villarrica all reported a baked shade range of 0.49–0.99,
 * spread 0.506, to three decimal places — because `volcanoProfile()` is a
 * function of radius alone and a heightfield built from it is a surface of
 * revolution. 126 volcanoes over five families is about twenty-five identical
 * copies of each, and the eye finds repeats fast.
 *
 * ==> AND IT IS NOT A SEPARATE SHADING FEATURE. <== `lib/volcano-ridge.js`
 * already computes a surface normal per vertex and bakes a light value into
 * the vertex colour. Terrain shading is what you get the moment the terrain
 * stops being a surface of revolution — there is no second pass here, no
 * light, no shader.
 *
 * ==> THE EXPENSIVE HALF IS DELIBERATELY ABSENT AND MUST NOT BE ADDED HERE.
 * <== Fine downhill gullies need roughly three times the grid: measured
 * 2026-07-31, tripling `ridge.cellsPerRadius` takes the build from 130,350
 * nodes to 1,108,989 and from 134–288 ms to 994–4,021 ms on a machine faster
 * than the phone this runs on. Everything in this file is a MODULATION of the
 * heightfield that already exists — zero extra samples, zero extra triangles.
 * The measured build cost of all of it is inside the run-to-run noise of the
 * build it modulates. If a future session wants gullies, that is resolution
 * that follows on-screen size and it is its own session.
 *
 * No THREE, no DOM, no MapLibre, no pixels. Plain numbers, so
 * `tools/test-volcano-variation.mjs` asserts every invariant below without a
 * browser — which is the only ground truth this project has.
 */

import { VOLCANO } from '../config/constants.js';

const V = VOLCANO.map3d.ridge.variation;

/**
 * Hermite ramp, 0 below 0 and 1 above 1. Shared with `lib/volcano-ridge.js`
 * rather than written twice — it is the second use, which is where a pattern
 * gets extracted.
 *
 * @param {number} t
 * @returns {number} 0..1
 */
export function smoothstep01(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * ==> SEEDED FROM THE CATALOG NUMBER, NOT FROM `Math.random`. <== Every
 * volcano gets its OWN shape and gets the same one on every reload, on every
 * device, forever. A handful of variants picked at random would be both
 * repetitive and unstable — a mountain that changes shape when you reload is
 * worse than a mountain that looks like its neighbour.
 *
 * xorshift32 on a multiplicatively hashed seed. The hash matters: GVP numbers
 * are dense and sequential within a region (Kamchatka runs 300240, 300250,
 * 300260…), and a raw sequential seed walks a xorshift's state in lockstep, so
 * the whole arc would come out nearly identical — which is the exact failure
 * this file exists to prevent, arriving by a different door.
 *
 * @param {number} seed
 * @returns {() => number} 0..1
 */
function rng(seed) {
  let x = (Math.imul(seed >>> 0 || 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  if (x === 0) x = 0x6d2b79f5;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

/**
 * ==> RADIAL, NEVER ISOTROPIC, AND THAT IS THE WHOLE DESIGN DECISION. <==
 * Isotropic noise dropped on a heightfield reads as gravel — it is the same
 * everywhere, so it says nothing about the shape underneath it. Variation that
 * runs DOWNHILL from the summit reads as a volcano: buttresses, spurs, one
 * long flank and one short one. So every term below is a function of BEARING
 * from the summit, constant along any downhill ray, expressed as harmonics of
 * the compass angle.
 *
 * Which harmonics is set by the grid, not by taste. There are about 21 samples
 * across a mountain, so roughly 33 cells around its mid-flank circumference: a
 * k=7 harmonic has about five cells per lobe and is the finest thing this grid
 * can hold without aliasing into a starfish. Anything above that is the gully
 * problem wearing a disguise.
 *
 * Coefficients, all derived from `variation.amount`:
 *   offset     how far off-centre the summit sits, in base radii
 *   amp[i]     amplitude of harmonic ks[i], as a fraction of the base radius
 *   norm       1 / the actual maximum of the harmonic sum over all bearings
 *   breach     how much of the crater rim is cut away on one side, 0..1
 *
 * @param {number} seed the GVP catalog number
 * @param {object} spec one entry of `VOLCANO.shapes.families`
 * @returns {object} frozen coefficients for `warpRadius` and `breachHeight`
 */
export function volcanoVariation(seed, spec) {
  const rnd = rng(seed);
  const a = V.amount;

  /* ==> THE SUMMIT OFFSET IS A DISPLACEMENT, NOT A HARMONIC, AND THAT IS WHY
   * IT COSTS NO FOOTPRINT. <== A k=1 harmonic on the radius makes one flank
   * long and the opposite one short, which is the same read — but it is a
   * change to the OUTLINE, so pinning the maximum at the true radius (below)
   * shrinks everything else to pay for it. This term instead slides the peak
   * sideways while leaving the rim exactly where it was: it is multiplied by
   * `1 - q`, so it is full strength at the axis and identically zero at the
   * footprint edge. It is the single largest character gain in this file and
   * the true footprint does not move by a metre for it. */
  const offBearing = rnd() * Math.PI * 2;
  const offset = a * V.summitOffset * (0.3 + 0.7 * rnd());

  const ks = [];
  const amp = [];
  const cp = [];
  const sp = [];
  for (const [k, weight] of V.harmonics) {
    ks.push(k);
    amp.push(a * weight * (0.4 + 0.6 * rnd()));
    const ph = rnd() * Math.PI * 2;
    cp.push(Math.cos(ph));
    sp.push(Math.sin(ph));
  }

  /* ==> THE TRUE RADIUS IS THE OUTER BOUND, NOT THE AVERAGE, AND NOTHING MAY
   * EVER EXCEED IT. <== A footprint that grows in any direction is the mistake
   * that killed `fill-extrusion` and then `inflate` (SPEC-GLOBES §42.1.4a and
   * §42.1.4b). So the harmonic sum is divided by its OWN maximum over all
   * bearings, which makes the widest bearing land exactly on the modelled
   * radius and every other bearing land inside it. The consequence is stated
   * rather than hidden: a varied mountain is on average NARROWER than an
   * unvaried one. Raising a family ratio to win the average back would be a
   * horizontal scale factor under a new name, and it is not done.
   *
   * The maximum is found by searching rather than bounded by the sum of the
   * amplitudes: with random phases the harmonics rarely align, so the bound is
   * loose by about a third and every mountain would pay for a peak that never
   * happens.
   *
   * ==> AND IT IS REFINED, BECAUSE A COARSE SCAN IS NOT A MAXIMUM. <== 256
   * samples put the true peak somewhere inside one step of the best sample,
   * which left the widest bearing about 0.02% outside the true footprint —
   * small, and still a footprint growing, which is the one thing this may not
   * do. The highest harmonic is k=7, so 256 samples is 36 per lobe and the
   * function is single-peaked inside the bracket around the best one; a golden
   * section closes it to machine precision in a few dozen evaluations, once
   * per volcano, at build time. */
  const harmonicAt = (th) => {
    let s = 0;
    /* Written the same way `warpRadius` writes it, so the maximum this finds
     * is the maximum of the function that actually runs. */
    for (let h = 0; h < ks.length; h++) {
      s += amp[h] * (Math.cos(ks[h] * th) * cp[h] + Math.sin(ks[h] * th) * sp[h]);
    }
    return s;
  };
  const SCAN = 256;
  const step = (Math.PI * 2) / SCAN;
  let bestTh = 0;
  let peak = -Infinity;
  for (let i = 0; i < SCAN; i++) {
    const th = i * step;
    const s = harmonicAt(th);
    if (s > peak) { peak = s; bestTh = th; }
  }
  let lo = bestTh - step;
  let hi = bestTh + step;
  for (let i = 0; i < 60; i++) {
    const a1 = lo + (hi - lo) / 3;
    const a2 = hi - (hi - lo) / 3;
    if (harmonicAt(a1) < harmonicAt(a2)) lo = a1;
    else hi = a2;
  }
  peak = Math.max(peak, harmonicAt((lo + hi) / 2));
  const norm = 1 / (1 + Math.max(0, peak));

  /* ==> A CRATER IS ELEVEN GRID CELLS ACROSS AND THE FLANK WARP SHREDS IT.
   * <== Measured over the drawn tier: every one of the 13 calderas samples its
   * crater at exactly 11.0 cells, so the rim ring is 5.5 cells from axis to
   * edge. A warp strong enough to give a cone character moves that rim by up
   * to a third of its radius — ±1.6 cells on a 5.5-cell bowl — and rendering
   * it confirmed what the arithmetic says: at `amount` 0.30 the bowl is gone
   * and a caldera reads as a lumpy hill, which is WORSE than the smooth one it
   * replaced. So on the one family that has a crater, the outline warp ramps
   * in from the rim outward and the crater keeps the shape `volcanoProfile()`
   * gives it. `spec.topR` already IS the rim radius — 0.04 on a cone, where
   * this changes nothing visible, and 0.55 on a caldera. */
  const hasCrater = spec.rim < 1;

  /* ==> THE LOPSIDED RIM IS ITS OWN TERM BECAUSE THE OUTLINE WARP CANNOT
   * EXPRESS IT. <== Warping the radius moves the rim IN and OUT; it cannot
   * move it UP and DOWN, so a caldera came out as an oval ring at one uniform
   * height. This cuts one sector of the rim down toward the crater floor and
   * leaves the opposite sector alone — a breach, the shape Vesuvius's Somma
   * and Mount St Helens have. It is subtractive and bounded by the rim's own
   * height above its own floor, so it can only ever lower the rim and can
   * never punch through the floor. */
  const breachBearing = rnd() * Math.PI * 2;

  return Object.freeze({
    offset,
    offC: Math.cos(offBearing),
    offS: Math.sin(offBearing),
    ks,
    amp,
    cp,
    sp,
    norm,
    hasCrater,
    topR: spec.topR,
    breach: hasCrater ? V.breach * (0.35 + 0.65 * rnd()) : 0,
    breachC: Math.cos(breachBearing),
    breachS: Math.sin(breachBearing),
  });
}

/**
 * ==> THE HOT FUNCTION. ONE CALL PER GRID NODE PER MEMBER, AND THERE IS NO
 * TRIGONOMETRY IN IT. <== `cos(kθ)` and `sin(kθ)` come off the angle-addition
 * recurrence from `cos θ` and `sin θ`, and those two are just the node's own
 * offset divided by its distance — which the caller has already computed. A
 * phase is folded in as a precomputed cosine and sine. So the whole thing is
 * multiplies and adds, and the measured build time with it is inside the
 * run-to-run noise of the build without it.
 *
 * @param {object} v from `volcanoVariation`
 * @param {number} q distance from the axis ÷ base radius, unvaried
 * @param {number} cosT east component of the bearing from the axis
 * @param {number} sinT north component of the bearing from the axis
 * @returns {number} the radius fraction to look up in the profile table
 */
export function warpRadius(v, q, cosT, sinT) {
  let ck = cosT;
  let sk = sinT;
  let kPrev = 1;
  let harm = 0;
  for (let i = 0; i < v.ks.length; i++) {
    const k = v.ks[i];
    while (kPrev < k) {
      const nc = ck * cosT - sk * sinT;
      const ns = sk * cosT + ck * sinT;
      ck = nc;
      sk = ns;
      kPrev++;
    }
    harm += v.amp[i] * (ck * v.cp[i] + sk * v.sp[i]);
  }

  /* The outline factor. `norm * (1 + harm)` is at most 1 by construction, so
   * `shape` is at most 1 and the mountain never reaches past its true radius.
   * On a crater family the deviation from 1 is faded in from the rim outward,
   * and the gate is evaluated on the UNVARIED q on purpose — a gate that fed
   * on its own output would be circular, and this one only has to be smooth. */
  let shape = v.norm * (1 + harm);
  if (v.hasCrater) {
    shape = 1 + smoothstep01((q - v.topR) / V.craterTaper) * (shape - 1);
  }

  /* The summit offset. Full at the axis, exactly zero at the rim, so the
   * outline is untouched by it. Clamped at zero because a node on the downhill
   * side of the shifted peak can land past the axis, and a negative radius has
   * no meaning in the profile table. */
  const shifted = q / shape - v.offset * (1 - q) * (cosT * v.offC + sinT * v.offS);
  return shifted > 0 ? shifted : 0;
}

/**
 * Cut one sector of a crater rim down toward its own floor.
 *
 * ==> BOUNDED BY THE RIM'S HEIGHT ABOVE ITS OWN FLOOR, WHICH IS WHAT MAKES IT
 * SAFE. <== It subtracts a fraction of `hf - floorFrac`, so on the flank below
 * the crater floor's level the term is zero and dies out on its own, the floor
 * itself never moves, and the rim can at worst come level with the floor. It
 * cannot raise anything, so the smooth-max merge's guarantee — that a summit
 * is never inflated by a neighbour — is untouched.
 *
 * Returns `hf` unchanged for every family without a crater, which is four of
 * the five.
 *
 * @param {object} v from `volcanoVariation`
 * @param {number} hf height fraction from `heightFrac`
 * @param {number} floorFrac the profile's height at the axis, 0..1
 * @param {number} cosT east component of the bearing from the axis
 * @param {number} sinT north component of the bearing from the axis
 * @returns {number} 0..1
 */
export function breachHeight(v, hf, floorFrac, cosT, sinT) {
  if (!v.hasCrater) return hf;
  const above = hf - floorFrac;
  if (above <= 0) return hf;
  /* One smooth lobe: full on the breach bearing, nothing on the far side. */
  const lobe = 0.5 * (1 + (cosT * v.breachC + sinT * v.breachS));
  return hf - above * v.breach * lobe;
}
