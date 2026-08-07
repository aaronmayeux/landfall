/**
 * plate-lines.js — the plate boundary network: chained, straightened, curved,
 * and named on both sides at one place.
 *
 * ONE PLACE TURNS THE RAW PB2002 FILE INTO WHAT BOTH RENDERERS DRAW. MapLibre
 * paints the magma stack and the labels; the Three globe draws the same seams
 * from space. Before this module they each read the file and built their own
 * geometry, which meant the two copies were only accidentally the same shape —
 * and they are pixel-locked through the dive, so "accidentally" was a bug
 * waiting for someone to change one of them.
 *
 * ---------------------------------------------------------------------------
 * FOUR STAGES, AND THE ORDER IS NOT INTERCHANGEABLE.
 *
 *   chain     → segments that meet end to end become one boundary
 *   simplify  → Douglas-Peucker, which is what actually kills the staircase
 *   spline    → the storm tracks' own curve through what survives
 *   label     → anchors, and a paired window on each side of each anchor
 *
 * ==> STAGE 2 IS THE ONE THAT EARNS THE FILE. <== The first version chained and
 * splined and skipped the middle stage, on the principle the storm tracks
 * follow: never move a published position. On glass the seams still read as
 * staircases, and the measurement says why — PB2002 digitises mid-ocean ridges
 * on a grid, so the MEDIAN turn between consecutive published segments on the
 * Mid-Atlantic Ridge is 83.8°, with 106 of 171 turns steeper than 70°. A spline
 * through those points rounds every corner and draws a rounded staircase. The
 * corners ARE the data; curve-fitting cannot help.
 *
 * So this stage deliberately breaks the storm-track rule, and
 * `PLATE_LINE.simplifyToleranceDeg` carries the argument and the cost: every
 * output point stays within 0.6° (~67 km) of the published line, which is inside
 * the generalisation PB2002 already admits to, and some of the right angles being
 * removed are REAL ridge-transform geometry rather than artefacts. It is a look
 * decision with a number attached, not a correction.
 *
 * CHAINING FIRST, BECAUSE BOTH LATER STAGES ARE WORSE WITHOUT IT. Simplifying a
 * 45-vertex fragment in isolation pins both of its ends; splining fragments
 * separately leaves a corner at every joint; and labelling them separately is
 * what put five copies of AFRICA down one ridge.
 *
 * ---------------------------------------------------------------------------
 * REVERSING A LINE SWAPS ITS SIDES, AND THAT IS WHAT MAKES CHAINING SAFE.
 *
 * PB2002 orders every boundary so `PlateA` lies to the LEFT of the direction of
 * travel (measured; see `config/plate-names.js`). Reverse the coordinates and
 * what was left is now right — so a reversed line with its pair ALSO swapped
 * describes exactly the same geography. That identity is what lets two features
 * published as `SA-AF` and `AF-SA` join into one chain: normalise every fragment
 * to a canonical pair order, reversing and relabelling as needed, and then
 * fragments that abut can simply be concatenated.
 *
 * ---------------------------------------------------------------------------
 * ==> WHY THE LABEL LINES ARE DISPLACED IN THE GEOMETRY INSTEAD OF WITH
 * `text-offset`. THIS IS THE ONE DESIGN DECISION IN THE FILE. <==
 *
 * MapLibre can push a line-following label sideways off its line with
 * `text-offset`, and that offset IS perpendicular to the curve — measured in a
 * real browser against real MapLibre 5.6.0, not assumed. It is also
 * pixel-constant, which is exactly what you want. It was the first choice and it
 * does not work, for one reason:
 *
 *   MapLibre flips a line label end-for-end when the line runs right-to-left on
 *   screen, so the text never reads upside down (`text-keep-upright`). The flip
 *   rotates the whole shaped label — INCLUDING its offset. Verified in the same
 *   harness: one line west-to-east put A above and B below; the identical line
 *   drawn east-to-west put them the other way round.
 *
 * That is not cosmetic. It labels the Pacific plate over California. And it
 * cannot be normalised away by ordering the source vertices consistently,
 * because the flip is decided from the label's SCREEN direction, live, every
 * frame — and `map/globe.js` enables `dragRotate` and `touchZoomRotate`, so the
 * user can turn the whole planet under it.
 *
 * Displacing the geometry itself is immune. The label sits on a line that is
 * already on the correct side, so whatever MapLibre then does with the glyphs —
 * flip them, rotate them, drop them — it cannot move them across the seam.
 *
 * THE PRICE IS THAT A GEOGRAPHIC OFFSET IS NOT PIXEL-CONSTANT, and it is paid
 * in three bands rather than pretended away (`PLATE_LINE.labelBands`).
 *
 * ---------------------------------------------------------------------------
 * PURE. Takes a parsed GeoJSON object, returns plain objects. The fetch, the
 * caching and the failure state belong to `map/plate-seams.js`, because those
 * are §5 questions about what the user sees when a file does not arrive, and
 * this file has no opinion about screens. Imports: config/ and lib/ only.
 */

import { PLATE_LINE } from '../config/plate-line.js';
import { plateName } from '../config/plate-names.js';
import { simplifyPath } from './simplify.js';
import { smoothPath } from './trackline.js';

const DEG = Math.PI / 180;

/** Left of travel is PlateA, right is PlateB. Named so the sign is never a
 *  bare +1/-1 at a call site — getting it backwards is the one failure mode
 *  this whole file is arranged around. */
const SIDE = Object.freeze({ left: 1, right: -1 });

/* ---------------------------------------------------------------------------
 * READING THE SOURCE
 * ------------------------------------------------------------------------- */

const isPt = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * Every drawable run in one feature, as arrays of `[lon, lat]`.
 *
 * SPLIT AT THE ANTIMERIDIAN, EVEN THOUGH TODAY'S FILE NEVER NEEDS IT. Checked
 * when this was written: PB2002 as shipped has zero consecutive pairs more than
 * 180° apart, so it is already pre-split. The guard stays because the cost is
 * one comparison per vertex and the failure it prevents is a straight line
 * drawn clean through the middle of the planet.
 */
function runsOf(feature) {
  const g = feature?.geometry;
  if (!g) return [];
  const parts = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
  const out = [];
  for (const part of parts) {
    if (!Array.isArray(part)) continue;
    let run = [];
    for (const c of part) {
      if (!isPt(c)) continue;
      if (run.length && Math.abs(c[0] - run[run.length - 1][0]) > 180) {
        if (run.length >= 2) out.push(run);
        run = [];
      }
      run.push([c[0], c[1]]);
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

/** Planar length of a run, degrees, latitude-corrected. Cheap and flat on
 *  purpose — every use here is a ratio or a ranking, never a distance anybody
 *  reads. */
function planarLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const cos = Math.max(Math.cos(((pts[i][1] + pts[i - 1][1]) / 2) * DEG), PLATE_LINE.minCosLat);
    total += Math.hypot((pts[i][0] - pts[i - 1][0]) * cos, pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

/* ---------------------------------------------------------------------------
 * STAGE 1 — CHAIN
 * ------------------------------------------------------------------------- */

/**
 * Group every run by the plate pair it separates, canonicalised, then join runs
 * that meet end to end.
 *
 * CANONICAL MEANS THE ALPHABETICALLY SMALLER CODE IS `A`. Runs whose published
 * order is the other way round are REVERSED as they are normalised, which swaps
 * which side each plate is on and therefore keeps the geography identical (see
 * the header). Without that step, the three fragments of the Mid-Atlantic Ridge
 * — published as `AF-SA`, `AF-SA` and `SA-AF` — land in two different buckets
 * and never join.
 *
 * O(n^2) WITHIN A GROUP AND THAT IS FINE. The largest group is a few dozen runs;
 * a spatial index here would be more code than the whole function.
 */
function chainRuns(features) {
  const groups = new Map();
  for (const f of features) {
    const a = f.properties?.PlateA || '';
    const b = f.properties?.PlateB || '';
    const type = f.properties?.Type || '';
    /* A boundary with only one named plate cannot be side-labelled, but it is
     * still a seam and still gets drawn — keyed on what it does have. */
    const flip = b < a;
    const key = flip ? `${b}|${a}` : `${a}|${b}`;
    if (!groups.has(key)) {
      groups.set(key, { codeA: flip ? b : a, codeB: flip ? a : b, types: new Set(), runs: [] });
    }
    const g = groups.get(key);
    if (type) g.types.add(type);
    for (const run of runsOf(f)) g.runs.push(flip ? run.slice().reverse() : run);
  }

  const eps = PLATE_LINE.chainEpsDeg;
  const same = (p, q) => Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps;
  const out = [];

  for (const g of groups.values()) {
    /* ==> ONLY THE FORWARD DIRECTION IS TRIED, AND THAT IS DELIBERATE. <== A
     * run could also be joined by reversing it, but reversing inside a group
     * would flip that fragment's sides relative to the rest of the chain —
     * exactly the bug the canonicalisation above exists to prevent. A fragment
     * that will not join forwards stays its own chain, which costs one extra
     * label and no correctness. */
    const pool = g.runs.slice();
    while (pool.length) {
      let chain = pool.shift();
      let joined = true;
      while (joined) {
        joined = false;
        for (let i = 0; i < pool.length; i++) {
          const r = pool[i];
          if (same(chain[chain.length - 1], r[0])) {
            chain = chain.concat(r.slice(1));
          } else if (same(r[r.length - 1], chain[0])) {
            chain = r.concat(chain.slice(1));
          } else {
            continue;
          }
          pool.splice(i, 1);
          joined = true;
          break;
        }
      }
      out.push({ codeA: g.codeA, codeB: g.codeB, type: [...g.types].join(' '), pts: chain });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * THE SIDEWAYS DISPLACEMENT
 * ------------------------------------------------------------------------- */

/**
 * A copy of `pts` pushed `deg` degrees to one side of its own direction of
 * travel.
 *
 * The normal is taken in the same latitude-corrected planar frame the spline
 * uses, then un-corrected per vertex on the way out, so the displacement is a
 * constant ground distance rather than a constant number of longitude degrees.
 * Without that, an Antarctic boundary's labels would sit twice as far off their
 * seam as an equatorial one's.
 *
 * ENDS USE THE ONE LEG THEY HAVE; interior vertices use the chord between their
 * neighbours, which is what keeps the offset copy smooth through a bend instead
 * of mitring at every vertex.
 */
function offsetRun(pts, side, deg) {
  /* Offset every vertex, keeping the source tangent alongside it — the fold
   * filter below needs to compare the two. */
  const raw = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const cosMid = Math.max(Math.cos(pts[i][1] * DEG), PLATE_LINE.minCosLat);
    const dx = (next[0] - prev[0]) * cosMid;
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const tx = dx / len;
    const ty = dy / len;

    /* ==> THE OFFSET IS CLAMPED BY LOCAL CURVATURE, AND THAT IS WHAT KEEPS THE
     * COPY A CURVE. <== Displace a curve inward by more than its own radius of
     * curvature and the copy turns inside out — the textbook offset cusp. On
     * PB2002 that happens constantly, because a plate boundary bends tighter than
     * a degree in plenty of places and the `far` band displaces by 1.1°.
     *
     * The worst case measured was the GALAPAGOS plate, whose entire boundary is
     * 5° long: offsetting it by 1.1° produced a window with a 161° reversal in
     * it. A whole small plate is smaller than the displacement meant for a whole
     * ocean.
     *
     * So the offset shrinks where the curve is tight. Radius is estimated from a
     * circular fit through this vertex and its neighbours — `L / (2 tan(θ/2))`,
     * where θ is the turn and L the shorter adjoining segment — and the
     * displacement is capped at a fraction of it. ONLY ON THE INSIDE: the outer
     * side of a bend can never fold, so clamping it there would pinch labels
     * toward the line for no reason. Which side is inside comes from the sign of
     * the turn, compared against the side being drawn. */
    let eff = deg;
    if (i > 0 && i < pts.length - 1) {
      const ax = (pts[i][0] - prev[0]) * cosMid;
      const ay = pts[i][1] - prev[1];
      const bx = (next[0] - pts[i][0]) * cosMid;
      const by = next[1] - pts[i][1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la > 0 && lb > 0) {
        const cross = ax * by - ay * bx;
        /* A left turn (cross > 0) puts the INSIDE on the left, which is
         * `SIDE.left` = +1. Same sign means this side is the inner one. */
        const inner = Math.sign(cross) === side;
        if (inner) {
          const theta = Math.abs(
            Math.atan2(cross, ax * bx + ay * by)
          );
          const half = Math.tan(Math.min(theta, Math.PI - 1e-6) / 2);
          if (half > 1e-9) {
            const radius = Math.min(la, lb) / (2 * half);
            eff = Math.min(eff, PLATE_LINE.curvatureSafety * radius);
          }
        }
      }
    }

    /* Left normal of the travel direction (tx, ty) is (-ty, tx). */
    /* ==> LATITUDE IS CLAMPED, AND IT IS NOT A TIDY-UP. <== A boundary running
     * along 87°N displaced north lands past 90°, which is not a coordinate.
     * MapLibre does not reject that one feature — geojson-vt fails on it and the
     * WHOLE SOURCE tiles to nothing, so every plate label on the planet
     * disappears because of two vertices in the Arctic. Measured exactly that
     * way in a headless run: 964 features in the source, 0 tiled, no error
     * anywhere and no glyphs ever requested. */
    raw.push({
      p: [
        pts[i][0] + (-ty * side * eff) / cosMid,
        Math.max(-90, Math.min(90, pts[i][1] + tx * side * eff)),
      ],
      t: [tx, ty],
      cos: cosMid,
    });
  }

  /* THE FOLD FILTER, as a backstop to the clamp above. A point is dropped when
   * the step to reach it runs AGAINST the source curve's own direction of travel
   * — which is exactly what a fold is, and is exact rather than a tolerance.
   * Walking forward from the last KEPT point means a run of folded vertices
   * collapses to nothing instead of each being judged against its folded
   * neighbour. The clamp handles the common case; this catches what is left. */
  const out = [];
  let last = null;
  for (const r of raw) {
    if (last) {
      const dx = (r.p[0] - last.p[0]) * last.cos;
      const dy = r.p[1] - last.p[1];
      if (dx * last.t[0] + dy * last.t[1] <= 0) continue;
    }
    out.push(r.p);
    last = r;
  }
  return out;
}

/** The sharpest turn anywhere along a run, degrees. What MapLibre's
 *  `text-max-angle` will judge the window by, computed here so an unusable
 *  window can be rejected in a pair rather than dropped silently by the
 *  renderer on one side only. */
function maxTurnDeg(pts) {
  let worst = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const cos = Math.max(Math.cos(pts[i][1] * DEG), PLATE_LINE.minCosLat);
    const ax = (pts[i][0] - pts[i - 1][0]) * cos;
    const ay = pts[i][1] - pts[i - 1][1];
    const bx = (pts[i + 1][0] - pts[i][0]) * cos;
    const by = pts[i + 1][1] - pts[i][1];
    const t = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) / DEG;
    if (t > worst) worst = t;
  }
  return worst;
}

/** Thin a run to roughly one vertex every `spacingDeg`. First and last always
 *  survive, so a short run is never emptied. */
function thin(pts, spacingDeg) {
  if (pts.length <= 2 || !(spacingDeg > 0)) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    const cos = Math.max(Math.cos(pts[i][1] * DEG), PLATE_LINE.minCosLat);
    if (Math.hypot((pts[i][0] - prev[0]) * cos, pts[i][1] - prev[1]) >= spacingDeg) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ---------------------------------------------------------------------------
 * STAGE 4 — ANCHORS AND WINDOWS
 * ------------------------------------------------------------------------- */

/**
 * Cumulative along-curve distance for every vertex, degrees.
 * Shared by the anchor picker and by the Three globe's shimmer, which needs the
 * same measure to make its wave travel.
 */
export function arcLengths(pts) {
  const arc = [0];
  for (let i = 1; i < pts.length; i++) {
    const cos = Math.max(Math.cos(((pts[i][1] + pts[i - 1][1]) / 2) * DEG), PLATE_LINE.minCosLat);
    arc.push(arc[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * cos, pts[i][1] - pts[i - 1][1]));
  }
  return arc;
}

/**
 * Where along this boundary the name pairs go.
 *
 * EVENLY SPACED, AND CENTRED — anchors sit at the middle of each `spacingDeg`
 * interval rather than at its edges, so a boundary exactly one interval long
 * gets its label in the middle instead of at one end. A boundary SHORTER than
 * one interval gets exactly one anchor at its midpoint, which is what guarantees
 * no boundary is ever nameless however coarse the spacing gets.
 */
function anchorsAlong(arc, spacingDeg) {
  const total = arc[arc.length - 1];
  if (!(total > 0)) return [];
  const n = Math.max(1, Math.round(total / spacingDeg));
  const out = [];
  for (let k = 0; k < n; k++) out.push((total * (k + 0.5)) / n);
  return out;
}

/** The slice of `pts` within `halfDeg` of arc position `at`, with at least two
 *  vertices. This is the fragment a label rides. */
function windowAround(pts, arc, at, halfDeg) {
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < pts.length - 1 && arc[lo + 1] < at - halfDeg) lo++;
  while (hi > 0 && arc[hi - 1] > at + halfDeg) hi--;
  if (hi - lo < 1) {
    lo = Math.max(0, Math.min(lo, pts.length - 2));
    hi = lo + 1;
  }
  return pts.slice(lo, hi + 1);
}

/** Where to look when an anchor's own position will not hold a label pair.
 *  Fractions of the band's anchor spacing, ordered outward from ideal so the
 *  result stays as close to evenly spaced as the seam allows. */
const ANCHOR_NUDGES = Object.freeze([0, 0.12, -0.12, 0.25, -0.25, 0.38, -0.38]);

/**
 * The two displaced label windows at one point along a seam, or `null` if either
 * side is unusable there.
 *
 * ==> A PAIR OR NOTHING. <== Both sides are built and both are checked before
 * either is returned.
 *
 * WHY THAT RULE EXISTS: a lone plate name is worse than no plate name. MapLibre
 * silently refuses to lay text around a bend past `text-max-angle`, and only the
 * INNER copy of a pair is bent by the displacement — so the failure mode is
 * systematically one-sided. Seen on glass: AFRICA labelled on the Mid-Atlantic
 * Ridge with nothing opposite it, which does not read as "the other name did not
 * fit", it reads as a statement about that plate.
 *
 * The turn check duplicates MapLibre's own judgement deliberately, using the same
 * constant, so the decision is made HERE where both halves can be seen at once
 * rather than independently inside the renderer.
 */
function pairAt(curve, arc, at, band, ctx) {
  const total = arc[arc.length - 1];
  const half = band.windowDeg / 2;
  /* Keep the window inside the seam. A window that runs off the end is shorter
   * than the label needs and MapLibre drops it without saying so. */
  const pos = Math.max(Math.min(at, total - half), half);
  if (!(total > 0)) return null;
  const spine = windowAround(curve, arc, pos, half);
  if (spine.length < 2) return null;

  const out = [];
  for (const [code, name, side] of [
    [ctx.codeA, ctx.nameA, SIDE.left],
    [ctx.codeB, ctx.nameB, SIDE.right],
  ]) {
    if (!name) continue;
    const w = thin(offsetRun(spine, side, band.offsetDeg), ctx.spacing);
    if (w.length < 2 || maxTurnDeg(w) > PLATE_LINE.labelMaxAngle) return null;
    out.push(line(w, { plate: name, tier: ctx.tierOf(code), band: band.id }));
  }
  return out.length ? out : null;
}

/* ---------------------------------------------------------------------------
 * THE BUILD
 * ------------------------------------------------------------------------- */

const line = (coords, props) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

/**
 * Turn the PB2002 collection into the two collections the map draws.
 *
 * @param {object} gj — the parsed `plate-boundaries.geojson`.
 * @returns {{seams: object, labels: object, stats: object}}
 *   `seams`   — chained, simplified, splined boundaries. Properties: `plateA`,
 *               `plateB` (full names), `codeA`, `codeB`, `type` (PB2002's own
 *               classification, `subduction` on many of them), `tier`.
 *   `labels`  — one short displaced window per side per anchor per band.
 *               Properties: `plate` (the full name to draw), `tier`, `band`.
 *   `stats`   — counts, for the status line. A count is what tells
 *               `none_matched` from `unavailable` (§5).
 */
export function buildPlateLines(gj) {
  const features = Array.isArray(gj?.features) ? gj.features : [];
  const chains = chainRuns(features);

  /* Pass one: how much boundary does each plate own? Measured on the CHAINED,
   * pre-simplification geometry — the ranking should not shift because a
   * tolerance moved. */
  const lengthByPlate = new Map();
  for (const c of chains) {
    const len = planarLength(c.pts);
    for (const code of [c.codeA, c.codeB]) {
      if (!code) continue;
      lengthByPlate.set(code, (lengthByPlate.get(code) || 0) + len);
    }
  }

  /** A plate's tier: 1 is a plate everybody has heard of, 3 is a fragment. */
  const tierOf = (code) => {
    const len = lengthByPlate.get(code) || 0;
    if (len >= PLATE_LINE.tierMajorDeg) return 1;
    if (len >= PLATE_LINE.tierMinorDeg) return 2;
    return 3;
  };

  const seams = [];
  const labels = [];
  let vertices = 0;
  let rawVertices = 0;
  let simplifiedVertices = 0;
  let anchorCount = 0;
  let rejected = 0;

  for (const c of chains) {
    const codeA = c.codeA;
    const codeB = c.codeB;
    const nameA = plateName(codeA);
    const nameB = plateName(codeB);
    const tier = Math.min(tierOf(codeA), tierOf(codeB));
    rawVertices += c.pts.length;

    /* STAGE 2 — the staircase dies here, before the spline ever sees it. */
    const straight = simplifyPath(c.pts, PLATE_LINE.simplifyToleranceDeg);
    simplifiedVertices += straight.length;

    /* STAGE 3 — asking for a DENSITY, not a total. `smoothPath` spreads whatever
     * budget it is given evenly across the legs, so `legs x samplesPerLeg` is how
     * you request uniform smoothness; the per-boundary ceiling then stops the
     * longest chain from spending the layer. Handing it a flat total instead
     * would make a short boundary silky and a long one straight. */
    const budget = Math.min(
      PLATE_LINE.maxVerticesPerBoundary,
      Math.max(1, straight.length - 1) * PLATE_LINE.samplesPerLeg
    );
    const curve = smoothPath(straight, budget);
    vertices += curve.length;
    seams.push(line(curve, { codeA, codeB, plateA: nameA, plateB: nameB, type: c.type, tier }));

    /* STAGE 4 — a paired window per anchor per band. */
    const arc = arcLengths(curve);
    for (const band of PLATE_LINE.labelBands) {
      const anchors = anchorsAlong(arc, band.anchorDeg);
      anchorCount += anchors.length;
      const spacing = band.windowDeg * PLATE_LINE.labelSpacingFraction;
      for (const at of anchors) {
        /* ==> AN ANCHOR THAT DOES NOT WORK IS NUDGED, NOT ABANDONED. <==
         *
         * A pair is only emitted if BOTH sides are usable (see `pairAt`), and 29%
         * of anchors failed that test on the first try — which left whole
         * boundaries unlabelled, including the Mid-Atlantic Ridge. The cause is
         * usually one sharp corner sitting inside the window, and the fix is to
         * look a little further along the seam rather than to give up on it or to
         * pack the anchors closer. Packing closer is the wrong lever: anchor
         * spacing is the density dial, and the whole point of this pass was
         * getting the density DOWN.
         *
         * Candidates are ordered outward from the anchor's ideal position, so the
         * label lands as close to evenly spaced as the geometry allows. */
        let pair = null;
        for (const shift of ANCHOR_NUDGES) {
          pair = pairAt(curve, arc, at + shift * band.anchorDeg, band, {
            codeA, nameA, codeB, nameB, tierOf, spacing,
          });
          if (pair) break;
        }
        if (pair) labels.push(...pair);
        else rejected++;
      }
    }
  }

  return {
    seams: { type: 'FeatureCollection', features: seams },
    labels: { type: 'FeatureCollection', features: labels },
    stats: {
      boundaries: seams.length,
      vertices,
      rawVertices,
      simplifiedVertices,
      anchors: anchorCount,
      rejectedAnchors: rejected,
      labels: labels.length,
      plates: lengthByPlate.size,
    },
  };
}
