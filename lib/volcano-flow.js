/**
 * volcano-flow.js — LAVA RUNS DOWNHILL, AND THIS IS THE DOWNHILL.
 *
 * Pure arithmetic. No THREE, no DOM, no fetch — so the whole model is asserted
 * by `tools/test-volcano-flow.mjs` without a browser, which matters because
 * every failure mode here is geometric and would otherwise only be visible as
 * "that looks wrong" on a phone.
 *
 * ==> §42.1.9 FORBADE THIS UNTIL 2026-07-31 AND THE PROHIBITION WAS RIGHT AT
 * THE TIME. <== It was rejected on two grounds. The first — that the grid is
 * far too coarse and fixing it is a blocking multi-second build — was measured
 * against ALL 240 drawn volcanoes. Lava draws on the handful actually erupting
 * lava, where the same refinement costs about a millisecond; the numbers are
 * on `VOLCANO.map3d.lava`. The second ground was honesty, and Aaron closed it
 * directly: no feed publishes a direction, we are not claiming one, and flows
 * leave in every direction at once precisely so nobody reads a bearing into
 * them.
 *
 * ==> WHAT IS AND IS NOT TRUE ABOUT THE RESULT, IN ONE PLACE. <== The flow
 * obeys the mountain it is drawn on, exactly, step by step. The MOUNTAIN is
 * invented — a profile of revolution warped by bearing harmonics seeded from
 * the catalog number (`lib/volcano-variation.js`), not a DEM. So this is lava
 * behaving correctly on a plausible mountain, and it will not match a
 * photograph of Etna. Anything stronger than that needs real elevation data
 * and is a separate project.
 *
 * ==> STEEPEST DESCENT IS THE WRONG MODEL AND IT IS THE OBVIOUS ONE. <== A
 * marble released at the crater traces the sharpest line down and reads as a
 * RAIN GULLY: thin, scratchy, turning hard into every dip. Lava is viscous. It
 * carries momentum through a bend instead of turning into it, and it fans out
 * and piles up where the gradient eases. Both are in `stepFlow` below and
 * neither is decoration — without them this feature looks like water and the
 * whole build was pointless.
 *
 * Imports: config/ and lib/ only.
 */

import { VOLCANO } from '../config/constants.js';
import { surfaceHeightAt } from './volcano-ridge.js';
import { smoothstep01 } from './volcano-variation.js';

const L = VOLCANO.map3d.lava;

/**
 * The downhill direction and steepness at a point, by central differences on
 * the analytic surface.
 *
 * ==> THE PROBE STEP IS THE FLOW'S OWN STEP, NOT THE GRID CELL. <== Probing at
 * the mesh resolution would quantise the gradient to the mesh and the flow
 * would move in staircases at exactly the scale the eye is watching. The
 * surface is analytic, so it can be asked at any spacing at all, and asking at
 * the distance the flow is about to travel is the spacing that matches what
 * the flow can actually respond to.
 *
 * @returns {{ge: number, gn: number, slope: number}} downhill unit vector and
 *   the drop per metre travelled along it
 */
function gradientAt(surf, e, n, h) {
  const zE = surfaceHeightAt(surf.local, surf.k, surf.anySubmarine, e + h, n);
  const zW = surfaceHeightAt(surf.local, surf.k, surf.anySubmarine, e - h, n);
  const zN = surfaceHeightAt(surf.local, surf.k, surf.anySubmarine, e, n + h);
  const zS = surfaceHeightAt(surf.local, surf.k, surf.anySubmarine, e, n - h);
  /* Downhill is the NEGATIVE gradient, hence the reversed subtraction. */
  const ge = (zW - zE) / (2 * h);
  const gn = (zS - zN) / (2 * h);
  const slope = Math.hypot(ge, gn);
  if (slope < 1e-9) return { ge: 0, gn: 0, slope: 0 };
  return { ge: ge / slope, gn: gn / slope, slope };
}

/**
 * Trace one flow from a launch point until it stalls, leaves the footprint, or
 * runs out of steps.
 *
 * @returns {object[]} path points `{e, n, z, speed}` in cluster-local metres
 */
function stepFlow(surf, startE, startN, footRadius, centreE, centreN, reachM) {
  const pts = [];
  let e = startE;
  let n = startN;
  /* Velocity in metres per step, carried BETWEEN steps. This single pair of
   * numbers is the entire difference between lava and water.
   *
   * ==> AND ON A SMOOTH CONE IT IS NEARLY A NO-OP. MEASURED, NOT ASSUMED. <==
   * Traced against pure steepest descent on Etna at 3x, the two paths end
   * within 0.0–9.1 degrees of each other and mostly under half a degree,
   * because a surface of revolution warped by four low harmonics has no sharp
   * turns for momentum to overshoot. It is kept because it DOES bite where the
   * ground is complicated — the saddle in a merged cluster, a caldera floor, a
   * shield's shallow apron — and because without it the direction jitters
   * wherever the gradient goes slack. What makes these read as lava on a cone
   * is the drainages and the finite reach, not this. */
  let ve = 0;
  let vn = 0;
  let travelled = 0;

  for (let i = 0; i < L.maxSteps; i++) {
    const z = surfaceHeightAt(surf.local, surf.k, surf.anySubmarine, e, n);
    pts.push({ e, n, z, travelled });

    const g = gradientAt(surf, e, n, L.stepM);

    /* ==> ACCELERATE, THEN DAMP, THEN MOVE — AND THE ORDER MATTERS. <== Damping
     * before accelerating lets a flow on a steep face reach full speed in one
     * step, which removes the run-up. */
    ve += g.ge * g.slope * L.gravity;
    vn += g.gn * g.slope * L.gravity;
    ve *= L.drag;
    vn *= L.drag;

    const moved = Math.hypot(ve, vn);
    /* ==> A STALL ENDS THE FLOW ON SHALLOW GROUND, WHERE IT IS THE RIGHT TEST.
     * <== It does NOT fire on a stratovolcano — the slope barely changes from
     * summit to foot — which is what `reachM` is for. Checked after at least
     * one step so a launch from rest is not mistaken for a stall. */
    if (i > 0 && moved < L.stallMps) break;

    /* Normalise the step length so `stepM` means what it says regardless of
     * how fast the flow is going; speed lives on in `ve`/`vn` as direction and
     * momentum. */
    if (moved > 1e-9) {
      e += (ve / moved) * L.stepM;
      n += (vn / moved) * L.stepM;
      travelled += L.stepM;
    }

    /* ==> THE FLOW RUNS OUT OF LAVA BEFORE IT RUNS OUT OF HILL. <== Without
     * this every flow reaches the footprint rim and the mountain ends up
     * entirely covered — measured on Etna, twelve of twelve at 15,060 m of a
     * 15,107 m radius. `VOLCANO.map3d.lava.reachQ` carries the reasoning. */
    if (travelled >= reachM) break;

    /* Off the modelled mountain entirely. Measured from the cluster centre
     * against the widest member, so a flow crossing a saddle into a
     * neighbour's territory keeps going rather than being cut at a boundary
     * that is not on screen. */
    if (Math.hypot(e - centreE, n - centreN) > footRadius) break;
  }
  return pts;
}

/**
 * Every lava flow on one cluster.
 *
 * ==> LAUNCHES ARE EVENLY SPACED AND THE TERRAIN DECIDES WHERE THEY GO. <==
 * That is the entire point of tracing rather than drawing ribbons: twelve
 * launches around a crater on a k=7 mountain converge into four or five real
 * channels, because the drainages are already in the shape. Nothing chooses
 * that number — it falls out.
 *
 * @param {object} ridge one result of `buildRidge`, carrying `surface`
 * @returns {object[]} flows, each `{flowPts, ventZ, member}`
 */
export function traceFlows(ridge) {
  if (!ridge || !ridge.surface) return [];
  const surf = ridge.surface;
  const erupting = surf.local.filter((m) => m.lava);
  if (erupting.length === 0) return [];

  /* The cut-off for a flow leaving the drawn mountain, measured once. */
  let footRadius = 0;
  for (const m of surf.local) {
    footRadius = Math.max(footRadius, Math.hypot(m.e, m.n) + m.radius);
  }

  const flows = [];
  for (const m of erupting) {
    for (let i = 0; i < L.launches; i++) {
      /* ==> THE LAUNCH RING IS OFFSET BY THE VOLCANO'S OWN SEED. <== Without
       * it every lava volcano launches its first flow due east, and two of
       * them on screen at once would visibly rhyme. The offset is a property
       * of the volcano, so it is the same on every reload — the same rule the
       * shape variation follows. */
      const phase = ((m.seed % 360) / 360) * ((Math.PI * 2) / L.launches);
      const th = (i / L.launches) * Math.PI * 2 + phase;

      /* ==> FLOWS OF IDENTICAL LENGTH READ AS A DRAWN STARBURST. <== Real ones
       * differ by a lot, because each is a different batch of lava down a
       * different gully. Varied from the volcano's seed and the launch index
       * so it is the same on every reload, same rule as the shape. The sine
       * is a cheap stable hash, not a wave — nothing here is periodic in `i`
       * in a way the eye can pick up at twelve launches. */
      const jitter = Math.sin(m.seed * 12.9898 + i * 78.233) * L.reachVary;
      const reachM = m.radius * L.reachQ * (1 + jitter);

      /* ==> A LAUNCH THAT LANDS ON THE CRATER FLOOR STALLS ON STEP ONE, AND A
       * FIXED RING CANNOT AVOID THAT FOR EVERY FAMILY. <== Measured on a
       * stratovolcano: launching at 0.045 of the base radius produced 7 flows
       * of 12, at 0.10 eleven, at 0.12 all twelve — because the summit is flat
       * out to about there and a flow needs a gradient to start. A caldera's
       * floor is far wider still, so no single constant is right for all five
       * silhouettes.
       *
       * So the ring is a STARTING GUESS and a stalled launch walks outward
       * until it finds ground that falls away. That is also what really
       * happens: lava issues from wherever the rim is breached, not from a
       * fixed distance off the axis. */
      let pts = [];
      for (let attempt = 0; attempt < L.launchTries; attempt++) {
        const r0 = m.radius * (L.launchQ + attempt * L.launchStep);
        pts = stepFlow(
          surf,
          m.e + Math.cos(th) * r0,
          m.n + Math.sin(th) * r0,
          footRadius,
          m.e,
          m.n,
          reachM
        );
        if (pts.length >= 3) break;
      }
      /* Still nothing after walking out — this bearing has no downhill on it
       * at all, which is correct for the inside of a breached rim. */
      if (pts.length < 3) continue;
      flows.push({ pts, member: m });
    }
  }
  return flows;
}

/**
 * Turn traced paths into ribbon geometry a renderer can hand to the GPU.
 *
 * Positions are cluster-local metres with Z up, matching `buildRidge` exactly,
 * so the caller places lava with the SAME matrix it places the mountain with.
 * Two matrices for one mountain is how lava ends up sliding relative to the
 * ground it is supposed to be on.
 *
 * `aT` is distance along the flow, 0 at the vent to 1 at the toe. `aU` is
 * across it, −1 at one edge to +1 at the other. **Both are needed and the
 * first build shipped with only `aT`, which is exactly why the bands came out
 * crossways** — with no cross-flow coordinate the only thing a shader can vary
 * on is distance, and varying brightness on distance draws stripes at right
 * angles to the direction of travel. Aaron on glass: *"the bands should be
 * parallel to the flow and trace the path."*
 *
 * @param {object[]} flows from `traceFlows`
 * @returns {{positions: Float32Array, ts: Float32Array, us: Float32Array, indices: number[]}|null}
 */
export function buildFlowRibbons(flows) {
  if (!flows || flows.length === 0) return null;

  const positions = [];
  const ts = [];
  const us = [];
  const indices = [];

  for (const flow of flows) {
    const pts = flow.pts;
    const first = positions.length / 3;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      /* Direction of travel here, from the neighbours, so the ribbon's cross
       * section is square to the flow rather than to the compass. */
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let de = b.e - a.e;
      let dn = b.n - a.n;
      const dl = Math.hypot(de, dn) || 1;
      de /= dl;
      dn /= dl;

      const t = i / (pts.length - 1);

      /* ==> THE WIDTH PROFILE HAS BEEN WRONG TWICE AND THIS IS THE THIRD
       * SHAPE. <== First it grew as the flow SLOWED, which put the fan on the
       * crater because a flow launches from rest. Then it grew monotonically
       * with distance, which was the right direction and still produced
       * rectangular slabs on glass — Aaron: *"these are rectangular shaped.
       * Shouldn't they taper at the beginning and ends?"* Correct, and a flow
       * tapers at BOTH ends for two different physical reasons: it issues from
       * a vent, which is a point, and it ends in a rounded lobate toe rather
       * than a square edge.
       *
       * So the profile is a vent taper, a body that widens as the flow spreads,
       * and a rounded nose. `noseAt` is where the toe starts rounding off. */
      let shape;
      if (t < L.ventTaper) {
        /* Out of the vent: narrow, opening smoothly rather than from zero, or
         * the first segment degenerates and the flow starts with a spike. */
        shape = L.ventWidth + (1 - L.ventWidth) * smoothstep01(t / L.ventTaper);
      } else if (t > L.noseAt) {
        /* The nose: a circular round-off, so the tip is a dome and not a
         * chisel. Never reaches zero — a flow toe is blunt. */
        const n = (t - L.noseAt) / (1 - L.noseAt);
        shape = Math.sqrt(Math.max(0, 1 - n * n)) * 0.92 + 0.08;
      } else {
        shape = 1;
      }
      /* The body still widens downhill on top of that shape — lava spreads as
       * it goes and thickens as it cools. */
      const half = L.widthM * shape * (1 + t * L.widthGain);

      /* Perpendicular in the ground plane. */
      const px = -dn * half;
      const py = de * half;

      positions.push(p.e + px, p.n + py, p.z + L.liftM);
      positions.push(p.e - px, p.n - py, p.z + L.liftM);
      ts.push(t, t);
      us.push(1, -1);
    }

    for (let i = 0; i < pts.length - 1; i++) {
      const a = first + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    ts: new Float32Array(ts),
    us: new Float32Array(us),
    indices,
  };
}
