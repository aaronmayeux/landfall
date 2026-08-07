/**
 * volcano-plume.js — HOW TALL THE ASH COLUMN IS, AND WHETHER THERE IS ONE.
 *
 * No THREE, no DOM, no fetch. Every rule in §42.1.5 that can be stated as
 * arithmetic is stated here so it can be asserted headlessly by
 * `tools/test-volcano-plume.mjs`, and so the renderer contains no judgement
 * about what the data means.
 *
 * ==> THE PUBLISHED NUMBER IS AN ALTITUDE AND WHAT THE SCREEN NEEDS IS A
 * HEIGHT, AND THE GAP BETWEEN THEM IS A WHOLE MOUNTAIN. <== A VAAC advisory
 * exists for aircraft, so it states the top of the ash cloud as a flight level
 * above sea level. Sabancaya's advisory says 21,000 ft and its plume is
 * **441 m**, because the summit is already at 5,960 m. Reading `plumeTopFeet`
 * as a column height draws that plume fourteen times too tall — and it fails
 * silently, because 6.4 km is a perfectly plausible-looking ash column.
 *
 * ==> AND THE SUBTRACTION IS NOT A CLAMP OR A CURVE. <== It is one minus the
 * other. Everything below is about what to do when one of the two numbers is
 * missing, and the answer is never to supply it.
 *
 * Imports: config/ only.
 */

import { VOLCANO } from '../config/volcano.js';
import { surfaceHeightAt } from './volcano-ridge.js';

const M3 = VOLCANO.map3d;
const P = M3.plume;

/** Feet to metres. The advisories publish flight levels; this layer is metric
 *  everywhere else, including the catalog's own elevations. */
const FT_TO_M = 0.3048;

/**
 * Is this volcano's ash advisory evidence of an ERUPTION?
 *
 * ==> WIND LIFTING OLD ASH OFF THE GROUND IS NOT AN ERUPTION, AND UNTIL NOW
 * THE GLOBE SAID IT WAS. <== The relay already flags resuspension
 * (`_vaa.js`), and §42.1.9 already forbids drawing a column from it. But the
 * erupting SET was still built from the mere presence of an active advisory,
 * so on 2026-07-31 Sabancaya sat on the globe in magma orange, in the erupting
 * count, with `NO ERUPTION - RESUSPENDED VA` in its own bulletin.
 *
 * The advisory is still true and still worth keeping — it is a real ash cloud
 * and a real hazard to aircraft. It is just not a volcano doing anything, and
 * a layer whose one job is showing what is erupting must not say otherwise.
 *
 * ==> THIS NARROWS ONE FEED, NOT THE UNION. <== A volcano dropped here can
 * still be erupting via the weekly report or a US alert level, and that is
 * correct: those are two other channels answering the same question with their
 * own evidence. §42.1.1's rule is that the erupting set is a union and never a
 * filter, and this leaves it a union.
 *
 * @param {object} live the `live` bag from one entry of the relay's `volcanoes`
 * @returns {boolean}
 */
export function isAshEruption(live) {
  const ash = live && live.ash;
  if (!ash) return false;
  if (ash.resuspended) return false;
  return true;
}

/**
 * Does this volcano earn an ash column, and how tall is it?
 *
 * `null` means no column at all, and it is the common answer — most erupting
 * volcanoes are not putting ash into the air right now.
 *
 * ==> ONLY AN **ACTIVE** ADVISORY DRAWS. <== `closing` is a centre standing an
 * advisory down and `quiet` is a centre still watching a volcano that is not
 * emitting. Both are bulletins that exist to say there is no ash cloud, so
 * drawing smoke from either is drawing the opposite of what was published.
 *
 * ==> AND LAVA-ONLY ERUPTIONS GET NOTHING HERE. <== Great Sitkin and Kilauea
 * are erupting and appear in no ash advisory anywhere on Earth, because they
 * are not making ash. Smoke over them would be the layer's first outright lie.
 * They take the flows in `lib/volcano-flow.js` instead.
 *
 * @param {object} live the `live` bag from one entry of the relay's `volcanoes`
 * @param {number} catalogElevM GVP's summit elevation, metres above sea
 * @returns {{m: number, stated: boolean, clamped: boolean}|null}
 */
export function plumeHeight(live, catalogElevM) {
  const ash = live && live.ash;
  if (!ash) return null;
  if (ash.status !== 'active') return null;
  /* §42.1.9: an eruption column drawn from resuspended dust is an invented
   * eruption. The mark stays; the smoke does not. */
  if (ash.resuspended) return null;

  const topFeet = numberOrNull(ash.plumeTopFeet);
  if (topFeet === null) return unknown();

  /* ==> THE CENTRE'S OWN ELEVATION FIRST, THE CATALOG SECOND, AND NOTHING
   * THIRD. <== The bulletin states the figure the centre subtracted against,
   * so using it means the two halves of the arithmetic come from the same
   * source. GVP's elevation is the fallback rather than the primary because
   * mixing sources is how a 40 m disagreement becomes a permanent 40 m error
   * nothing on screen can reveal. When BOTH are missing there is no
   * subtraction to do, and the honest answer is the untopped puff — never
   * treating the flight level as a height, which is the whole trap. */
  const baseM = firstFinite(ash.sourceElevM, catalogElevM);
  if (baseM === null) return unknown();

  const raw = topFeet * FT_TO_M - baseM;

  /* A stated height at or below zero means the centre's flight level and the
   * centre's elevation disagree — real, rare, and not a parse failure. Drawn
   * small rather than inverted or dropped, and counted so it can be seen. */
  if (raw < P.minM) return { m: P.minM, stated: true, clamped: true };
  return { m: raw, stated: true, clamped: false };
}

/**
 * ==> "ASH, HEIGHT NOT STATED" IS A REAL ANSWER AND IT MUST LOOK LIKE ONE.
 * <== §42.1.5 is binding here: never an average, never a plausible-looking
 * column. A low puff, deliberately shorter than the smallest plume ever
 * measured on this feed, and the renderer cuts its top off so the refusal is
 * visible in the silhouette.
 */
function unknown() {
  return { m: P.unknownM, stated: false, clamped: false };
}

/** The first argument that is a usable number, or null. */
function firstFinite(...values) {
  for (const v of values) {
    const n = numberOrNull(v);
    if (n !== null) return n;
  }
  return null;
}

/**
 * ==> `Number(null)` IS ZERO AND THAT COST THREE ASSERTIONS BEFORE GLASS EVER
 * SAW IT. <== A missing plume top and a missing elevation both arrive as
 * `null` on the wire, and the obvious `Number.isFinite(Number(v))` guard waves
 * both through as a measured zero — which put a volcano at sea level and drew
 * its whole flight level as a column, the exact error this module exists to
 * prevent. `Number('')` is zero too.
 *
 * ==> AND THE FIX IS NOT `if (!v)`. <== A volcano at sea level is a real thing
 * and a genuine zero has to survive. So absence is tested for by name.
 */
function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* -------------------------------------------------------- the column itself */

/**
 * Every ash column on one cluster, as a stack of soft quads.
 *
 * ==> A STACK OF BILLBOARDS, AND THE REASON IS THAT THE SORT PROBLEM DOES NOT
 * EXIST HERE. <== Transparent geometry has to be drawn back to front, and the
 * usual answer for a puff of smoke is a per-frame depth sort on the CPU, which
 * on a globe whose camera never rests is the most expensive thing this layer
 * could possibly do. It is unnecessary: the camera can never go below
 * `TILT.maxDeg` off vertical, so it is **always above the column**, so the top
 * of a vertical stack is always nearer the camera than its base. Back to front
 * is base first, top last, forever. The order is baked into the index buffer
 * once and is correct for every frame at every angle. That is the whole reason
 * §42.1.5 chose billboards over splats.
 *
 * ==> THE QUADS ARE EMITTED IN LOCAL METRES WITH NO CAMERA IN THEM. <== Turning
 * a quad to face the viewer is one rotation about the vertical axis, and it is
 * done in the vertex shader from a single uniform, because it changes every
 * time the map is rotated and this geometry is built once per field. A column
 * only ever spins about its own axis — it must never roll, which is what a
 * full screen-facing billboard would do the moment the map is pitched.
 *
 * ==> HEIGHT IS EXAGGERATED, WIDTH IS NOT, AND THAT IS THE MOUNTAINS' OWN LIE
 * REPEATED DELIBERATELY. <== `lib/volcano-ridge.js` §251 states it: relief
 * carries `map3d.vertical` and radius does not. A plume that ignored it would
 * be a true-scale wisp on a 4x mountain — the two would visibly disagree about
 * what a metre is. `plume.exaggerationRatio` multiplies on top, so moving the
 * mountains on glass moves the columns with them.
 *
 * @param {object} ridge one result of `buildRidge`, carrying `surface`
 * @returns {object|null} buffers, or null when nothing on this cluster erupts ash
 */
export function buildPlumeColumns(ridge) {
  if (!ridge || !ridge.surface) return null;
  const surf = ridge.surface;
  const smoking = surf.local.filter((m) => m.plume && m.plume.m > 0);
  if (smoking.length === 0) return null;

  const positions = [];
  const offs = [];
  const halfs = [];
  const rises = [];
  const alphas = [];
  const seeds = [];
  const indices = [];

  const rows = Math.max(2, P.puffs);
  const vscale = M3.vertical * P.exaggerationRatio;

  for (const m of smoking) {
    /* ==> THE VENT IS THE MOUNTAIN THAT IS DRAWN, NOT THE ONE IN THE CATALOG.
     * <== The same rule lava follows. Reading the summit off `elev` would put
     * the column's foot at the volcano's true altitude while the mesh on
     * screen carries an exaggeration, a smoothed profile and a shared flank
     * with its cluster neighbours — so the plume would hang in the air or sink
     * into the rock, and which one would depend on the volcano. */
    const ventZ = surfaceHeightAt(surf.local, surf.k, surf.anySubmarine, m.e, m.n);
    const heightZ = m.plume.m * vscale;
    /* Vertical half-height of one quad. Set to the full row spacing so
     * consecutive puffs overlap by half their height in each direction and the
     * stack reads as one continuous column rather than as a row of beads. */
    const spacing = heightZ / (rows - 1);

    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const halfH = P.ventWidthM * (1 + (P.spread - 1) * t);
      const base = positions.length / 3;

      /* ==> FOUR CORNERS IN QUAD-LOCAL COORDINATES, AND THE POSITION IS THE
       * CENTRE. <== The corner offset cannot be baked into the position: which
       * way "sideways" points is not known until the map's bearing is, and
       * that is a per-frame fact. */
      for (const [ox, oy] of CORNERS) {
        positions.push(m.e, m.n, ventZ + t * heightZ);
        offs.push(ox, oy);
        halfs.push(halfH, spacing);
        rises.push(t);
        alphas.push(alphaAt(t, m.plume.stated));
        /* Stable per-volcano, per-row phase so two columns on screen at once
         * do not boil in lockstep, and so the same volcano boils the same way
         * on every reload. Same rule the shape variation follows. */
        seeds.push((m.seed % 211) * 0.37 + i * 1.7);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  return {
    positions,
    offs,
    halfs,
    rises,
    alphas,
    seeds,
    indices,
    /** How many columns this cluster drew. Reported so `status()` can tell
     *  "nothing is erupting ash" from "the shader did not build". */
    columns: smoking.length,
  };
}

/** Quad corners, counter-clockwise, in units of the quad's own half-size. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Opacity at a fraction `t` up the column.
 *
 * ==> THE TWO SHAPES SAY TWO DIFFERENT THINGS AND THE DIFFERENCE IS THE POINT.
 * <== §42.1.5's binding rule: a plume whose height was published is drawn at
 * that height and dissolves at the top the way a real one does. A plume with
 * NO published height must **visibly refuse to state one** — so it is short,
 * it is even, and it stops dead. A flat top is not a rendering defect here; it
 * is the honest shape, and the alternative is a tapered column that looks
 * exactly like a measured one and is not.
 *
 * @param {number} t 0 at the vent, 1 at the top
 * @param {boolean} stated did the advisory publish a height
 */
function alphaAt(t, stated) {
  if (!stated) return P.opacity * P.unknownTopFade;
  return P.opacity * Math.pow(1 - t, P.fadePow);
}
